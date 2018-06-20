/*
Gordon Williams (gw@pur3.co.uk)
*/
(function() {

  if (typeof window == "undefined" || typeof WebSocket == undefined) return;
  console.log("WebSocket localhost support (EspruinoHost) enabled - running in web browser");

  var WS_ENABLED = true;
  var ws;
  var wsConnecting = false;
  var wsConnectCallbacks = [];
  var listOfDevices = [];
  var dataWrittenCallbacks = [];
  var listCallbacks = []; // callbacks for 'list' command
  var connectCallback;
  var disconnectCallback;
  var receiveCallback;

  function ensureConnection(callback) {
    if (wsConnecting) {
      console.log("Waiting for Websocket connection - queueing");
      wsConnectCallbacks.push(callback);
      return;
    }
    if (ws) return callback();
    if (!Espruino.Config.WEBSOCKET_URL)
      return callback("No websocket URL");
    ws = new WebSocket(Espruino.Config.WEBSOCKET_URL);
    wsConnectCallbacks = [callback];
    wsConnecting = true;
    ws.onerror = function(event) {
      ws = undefined;
      wsConnecting = false;
      callback("WebSocket error");
    };
    ws.onopen = function() {
      wsConnecting = false;
      ws.onerror = undefined;
      ws.onmessage = function (event) {
        wsMessage(event);
      };
      ws.onclose = function(event) {
        wsClosed(event);
      };
      wsConnectCallbacks.forEach(function(cb) { cb(); });
    }
  }

  function wsMessage(event) {
    console.log("Got "+event.data);
    try {
      var j = JSON.parse(event.data);
      if (j.type=="list") {
        listOfDevices = j.ports;
        var portList = [];
        j.ports.forEach(function(port) {
          portList.push({
            path: port.path,
            description: port.description,
            type: port.interface
          });
        });
        listCallbacks.forEach(function(cb) {
          cb(portList, false/*instantPorts*/);
        });
        listCallbacks = [];
      } else if (j.type=="connect") {
        if (connectCallback) {
          connectCallback({ok:true});
          connectCallback = undefined;
        }
      } else if (j.type=="disconnect") {
        if (disconnectCallback) {
          disconnectCallback();
          disconnectCallback = undefined;
        }
      } else if (j.type=="read") {
        if (receiveCallback) {
          receiveCallback(Espruino.Core.Utils.stringToArrayBuffer(j.data));
        }
      } else if (j.type=="write") {
        dataWrittenCallbacks.forEach(function(cb) {
          console.log("Calling data written cb");
          cb();
        });
        dataWrittenCallbacks = [];
      }
    } catch (e) {
      console.log("Error processing JSON response: "+event.data);
    }
  }

  function wsClosed(event) {
    ws = undefined;
    console.log("WebSocket closed");
    disconnectCallback();
    disconnectCallback = undefined;
  }

  var getPorts=function(callback) {
    if (!WS_ENABLED) return callback([]);
    ensureConnection(function(err) {
      if (err) {
        WS_ENABLED = false;
        console.log("Couldn't connect to "+Espruino.Config.WEBSOCKET_URL+" - disabling websockets for this session");
        return callback([], false/*instantPorts*/);
      } else {
        listCallbacks.push(callback);
        ws.send(JSON.stringify({"type":"list"}));
      }
    });
  };

  var openSerial=function(serialPort, _connectCallback, _receiveCallback, _disconnectCallback) {
    var device = listOfDevices.find(dev=>dev.path==serialPort);
    if (!device) {
      console.err("Tried to connect to "+serialPort+" but it didn't exist!");
      return openCallback(); // open failed
    }


    ensureConnection(function(err) {
      if (err) {
        return openCallback(); // open failed
      } else {
        connectCallback = _connectCallback;
        disconnectCallback = _disconnectCallback;
        receiveCallback = _receiveCallback;
        ws.send(JSON.stringify({
          "type":"connect",
          "interface":device.interface,
          "path":device.path,
          "baud":parseInt(Espruino.Config.BAUD_RATE)
        }));
      }
    });
  };

  var closeSerial=function(callback) {
    if (!ws) return;
    ws.send(JSON.stringify({"type":"disconnect"}));
  };

  var writeSerial = function(data, callback) {
    if (!ws) return callback();
    dataWrittenCallbacks.push(callback);
    console.log(JSON.stringify({"type":"write", data:data}));
    ws.send(JSON.stringify({"type":"write", data:data}));
  };

  // ----------------------------------------------------------
  Espruino.Core.Serial.devices.push({
    "name" : "Websocket to EspruinoHost",
    "getPorts": getPorts,
    "open": openSerial,
    "write": writeSerial,
    "close": closeSerial,
  });
  Espruino.Core.SerialWebSocketLocal = {
    "init": function() {
      Espruino.Core.Config.add("WEBSOCKET_URL", {
        section : "Communications",
        name : "Websocket URL",
        description : "The URL of a websocket server that that connect to an Espruino device",
        type : "string",
        defaultValue : "wss://localhost:31234"
      });
    }
  };
})();
