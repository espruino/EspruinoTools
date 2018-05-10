/*
Gordon Williams (gw@pur3.co.uk)

If we're running in an iframe, this gets enabled and allows the IDE
to work by passing messages using window.postMessage.

Use embed.js on the client side to link this in.
*/

(function() {
  if (typeof window == "undefined" || typeof window.parent == undefined) return;
  console.log("Running in a frame - enabling frame messaging support");

  var callbacks = {
    connected : undefined,
    receive : undefined,
    written : undefined,
    disconnected : undefined,
    ports : undefined
  };

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

  window.addEventListener('message', function(e) {
    var event = e.data;
    //console.log("IDE MESSAGE ---------------------------------------");
    //console.log(event);
    //console.log("-----------------------------------------------");
    if (typeof event!="object" || event.for!="ide") return;
    switch (event.type) {
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
        callbacks.receive(str2ab(event.data));
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

  Espruino.Core.Serial.devices.push({
    "name" : "window.postMessage",
    "init" : function() {
      post({type:"init"});
    },
    "getPorts": function(callback) {
      post({type:"getPorts"});
      var timeout = setTimeout(function() {
        timeout = undefined;
        callbacks.ports = undefined;
        callback([]);
        console.error("serial_frame: getPorts timeout");
      },100);
      callbacks.ports = function(d) {
        if (!timeout) {
          console.error("serial_frame: ports received after timeout");
          return;
        }
        clearTimeout(timeout);
        timeout = undefined;
        callback(d);
      };
    },
    "open": function(path, openCallback, receiveCallback, disconnectCallback) {
      callbacks.connected = openCallback;
      callbacks.receive = receiveCallback;
      callbacks.disconnected = disconnectCallback;
      post({type:"connect"});
    },
    "write": function(d, callback) {
      callbacks.written = callback;
      post({type:"write",data:d});
    },
    "close": function() {
      post({type:"disconnect"});
    },
  });
})();
