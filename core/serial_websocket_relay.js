/*
Gordon Williams (gw@pur3.co.uk)

Used for Relay service on espruino.com/ide as well as `npm espruino-web-ide`'s
`espruino-server`.
*/
(function() {

  if (typeof window == "undefined" || typeof WebSocket == undefined) return;

  if (/*window.location.origin=="https://www.espruino.com" || */
      window.location.origin=="https://espruino.github.io") {
    console.log("Running from github - WebSocket support disabled");
    return;
  }
  console.log("WebSocket relay support enabled - running in web browser");

  var WS_ENABLED = true;
  var ws;
  var dataWrittenCallbacks = [];

  var getPorts=function(callback) {
    if (Espruino.Config.RELAY_KEY) {
      callback([{path:'Web IDE Relay', description:'BLE connection via a phone', type : "bluetooth"}], true/*instantPorts*/);
    } else {
      if (!WS_ENABLED) return callback([], true/*instantPorts*/);
      Espruino.Core.Utils.getJSONURL("/serial/ports", function(ports) {
        if (ports===undefined) {
          console.log("/serial/ports doesn't exist - disabling WebSocket support");
          WS_ENABLED = false;
          callback([]);
          return;
        }
        if (!Array.isArray(ports)) callback([], true/*instantPorts*/);
        else callback(ports, true/*instantPorts*/);
      });
    }
  };

  var openSerial=function(serialPort, openCallback, receiveCallback, disconnectCallback) {
    if (Espruino.Config.RELAY_KEY) {
      ws = new WebSocket("wss://" + window.location.host + ":8443/", "espruino");
    } else {
      ws = new WebSocket("ws://" + window.location.host + "/" + serialPort, "serial");
    }
    dataWrittenCallbacks = [];
    ws.onerror = function(event) {
      connectCallback(undefined);
      ws = undefined;
    };
    ws.onopen = function() {
      if (Espruino.Config.RELAY_KEY) {
        ws.send("\x10"+Espruino.Config.RELAY_KEY);
      }
      openCallback("Hello");
      ws.onerror = undefined;
      ws.onmessage = function (event) {
        //console.log("MSG:"+event.data);
        if (event.data[0]=="\x00") {
          receiveCallback(Espruino.Core.Utils.stringToArrayBuffer(event.data.substr(1)));
        } else if (event.data[0]=="\x02") {
          // if it's a data written callback, execute it
          var c = dataWrittenCallbacks.shift();
          if (c) c();
        }
      };
      ws.onclose = function(event) {
        currentDevice = undefined;
        if (disconnectCallback) disconnectCallback();
        disconnectCallback = undefined;
        ws = undefined;
      };
    }
  };

  var closeSerial=function(callback) {
    if (ws) {
      ws.close();
      ws = undefined;
    }
  };

  var writeSerial = function(data, callback) {
    dataWrittenCallbacks.push(callback);
    if (ws) ws.send("\x01"+data);
  };

  // ----------------------------------------------------------
  Espruino.Core.Serial.devices.push({
    "name" : "Websocket Relay",
    "getPorts": getPorts,
    "open": openSerial,
    "write": writeSerial,
    "close": closeSerial,
  });
  if (window.location.host.substr(-16) == "www.espruino.com") {
    Espruino.Core.SerialWebSocketRelay = {
      "init": function() {
        Espruino.Core.Config.add("RELAY_KEY", {
          section : "Communications",
          name : "Relay Key",
          description : "The key displayed when https://www.espruino.com/ide/relay is viewed on a phone. You'll then be able to use the Web IDE on your PC",
          type : "string",
          defaultValue : ""
        });
      }
    };
  }
})();
