/*
Gordon Williams (gw@pur3.co.uk)

If we're running in an iframe, this gets enabled and allows the IDE
to work by passing messages using window.postMessage.

Use embed.js on the client side to link this in.
*/

(function() {
  if (typeof navigator == "undefined" || typeof window == "undefined") {
    console.log("serial_frame: Not running in a browser");
    return;
  }
  if (typeof window.parent == undefined ||
      window.parent === window) {
    console.log("serial_frame: Not running inside an iframe");
    return;
  }

  var ERROR = "No 'init' message received";

  function getStatus(ignoreSettings) {
    if (ERROR)
      return {error:ERROR};
    return true;
  }

  var callbacks = {
    connected : undefined,
    receive : undefined,
    written : undefined,
    disconnected : undefined,
    ports : undefined
  };

  window.addEventListener('message', function(e) {
    var event = e.data;
    //console.log("IDE MESSAGE ---------------------------------------");
    //console.log(event);
    //console.log("-----------------------------------------------");
    if (typeof event!="object" || event.for!="ide") return;
    switch (event.type) {
      case "initialised": {
        ERROR = false;
      } break;
      case "ports": if (callbacks.ports) {
        callbacks.ports(event.data);
        callbacks.ports = undefined;
      } break;
      case "connect":
        if (Espruino.Core.Serial.isConnected())
          console.error("serial_frame: already connected");

        Espruino.Core.MenuPortSelector.connectToPort(event.data, function() {
          console.log("serial_frame: connected");
        });
        break;
      case "connected": if (callbacks.connected) {
        callbacks.connected({ok:true});
        callbacks.connected = undefined;
      } break;
      case "disconnected": if (callbacks.disconnected) {
        callbacks.disconnected();
        callbacks.disconnected = undefined;
      } break;
      case "written": if (callbacks.written) {
        callbacks.written();
        callbacks.written = undefined;
      } break;
      case "receive": if (callbacks.receive) {
        if (typeof event.data!="string")
          console.error("serial_frame: receive event expecting data string");
        callbacks.receive(Espruino.Core.Utils.stringToArrayBuffer(event.data));
      } break;
      case "setMaxWriteLength": {
        // Set the maximum amount of data we're allowed to write in one go
        device.maxWriteLength = parseInt(event.data);
      } break;
      default:
        console.error("Unknown event type ",event.type);
        break;
    }
  });

  function post(msg) {
    msg.from="ide";
    window.parent.postMessage(msg,"*");
  }

  var device = {
    "name" : "Embedded IDE",
    "init" : function() {
      post({type:"init"});
    },
    getStatus : getStatus,
    "getPorts": function(callback) {
      if (ERROR !== false) {
        callback([], true/*instantPorts*/);
        return;
      }
      post({type:"getPorts"});
      var timeout = setTimeout(function() {
        timeout = undefined;
        callbacks.ports = undefined;
        callback([], false/*instantPorts*/);
        ERROR = "getPorts timeout, disabling";
        console.error("serial_frame: "+ERROR);
      },100);
      callbacks.ports = function(d) {
        if (!timeout) {
          console.error("serial_frame: ports received after timeout");
          return;
        }
        clearTimeout(timeout);
        timeout = undefined;
        callback(d, false/*instantPorts*/);
      };
    },
    "open": function(path, openCallback, receiveCallback, disconnectCallback) {
      callbacks.connected = openCallback;
      callbacks.receive = receiveCallback;
      callbacks.disconnected = disconnectCallback;
      post({type:"connect",data:path});
    },
    "write": function(d, callback) {
      callbacks.written = callback;
      post({type:"write",data:d});
    },
    "close": function() {
      post({type:"disconnect"});
    },
  };
  Espruino.Core.Serial.devices.push(device);
})();
