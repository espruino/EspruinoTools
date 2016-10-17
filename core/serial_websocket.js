/*
Gordon Williams (gw@pur3.co.uk)
*/
(function() {

  if (typeof window == "undefined" || typeof WebSocket == undefined) return;
  console.log("WebSockets support enabled - running in web browser");
  var ws;
  var dataWrittenCallbacks = [];

  var str2ab=function(str) {
    var buf=new ArrayBuffer(str.length);
    var bufView=new Uint8Array(buf);
    for (var i=0; i<str.length; i++) {
      var ch = str.charCodeAt(i);
      if (ch>=256) {
        console.warn("Attempted to send non-8 bit character - code "+ch);
        ch = "?".charCodeAt(0);
      }
      bufView[i] = ch;
    }
    return buf;
  };

  var getPorts=function(callback) {
    Espruino.Core.Utils.getJSONURL("/serial/ports", function(ports) {
       if (!Array.isArray(ports)) callback([]);
       else callback(ports);
    });
  };

  var openSerial=function(serialPort, openCallback, receiveCallback, disconnectCallback) {
    ws = new WebSocket("ws://" + location.host + "/" + serialPort, "serial");
    dataWrittenCallbacks = [];
    ws.onerror = function(event) {
      connectCallback(undefined);
      ws = undefined;
    };
    ws.onopen = function() {
      Espruino.callProcessor("connected", undefined, function() {
        openCallback("Hello");
      });
      ws.onerror = undefined;
      ws.onmessage = function (event) {
        //console.log("MSG:"+event.data);
        if (event.data[0]=="R") {
          receiveCallback(str2ab(event.data.substr(1)));
        } else {
          // if it's a data written callback, execute it
          var c = dataWrittenCallbacks.shift();
          if (c) c();
        }
      };
      ws.onclose = function(event) {
        currentDevice = undefined;
        Espruino.callProcessor("disconnected", undefined, function() {
          disconnectCallback();
        });
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
    if (ws) ws.send(data);
  };

  // ----------------------------------------------------------
  Espruino.Core.Serial.devices.push({
    "getPorts": getPorts,
    "open": openSerial,
    "write": writeSerial,
    "close": closeSerial,
  });
})();
