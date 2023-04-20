/*
Gordon Williams (gw@pur3.co.uk)

Used for Relay service on espruino.com/ide as well as `npm espruino-web-ide`'s
`espruino-server`.
*/
(function() {
  var autoconnect = false;
  // Support for websockets on Node.js...
  if (typeof WebSocket == "undefined" || typeof require!=="undefined") {
    try {
      WebSocket = require("ws").WebSocket;
    } catch (e) {
      console.log("'ws' module not installed");
    }
    // The Espruino cert can't be verified (I think because we're using port 8443?)
    process.env['NODE_TLS_REJECT_UNAUTHORIZED'] = 0;
    autoconnect = true; // when using the CLI and a relay key is set, autoconnect
  }
  // ... but if we don't have them there's nothing we can do...
  if (typeof WebSocket == "undefined") return;
  
  // default host...
  var host = "www.espruino.com";
  if (typeof window != "undefined") {
    host = window.location.host;
  }

  if (/*host=="www.espruino.com" || */
      host=="espruino.github.io") {
    console.log("Running from GitHub - WebSocket support disabled");
    return;
  }
  console.log("WebSocket relay support enabled");

  var ws;
  var dataWrittenCallbacks = [];

  var getPorts=function(callback) {
    if (Espruino.Config.RELAY_KEY) {
      var p = {path:'Web IDE Relay', description:'BLE connection via a phone', type : "bluetooth"};
      if (autoconnect) p.autoconnect = true;
      callback([p], true/*instantPorts*/);
    } else {
      return callback([], true/*instantPorts*/);
    }
  };

  var openSerial=function(serialPort, openCallback, receiveCallback, disconnectCallback) {
    ws = new WebSocket("wss://" + host + ":8443/", "espruino");
    dataWrittenCallbacks = [];
    ws.onerror = function(e) {
      console.log("WebSocket error ",e.message);
      if (disconnectCallback) disconnectCallback(undefined);
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
  if (host.substr(-16) == "www.espruino.com") {
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
