/*
Gordon Williams (gw@pur3.co.uk)

Remote connections using Peer.js

Needs:

libs/webrtc-connection.js
EspruinoWebIDE/js/libs/qrcode.min.js

*/
var webrtc; // Our WebRTC connection

(function() {

  if (typeof Peer == "undefined") {
    console.log("Peer.js not loaded - Remote Connection disabled");
    return;
  }
  if (typeof webrtcInit == "undefined") {
    console.log("libs/webrtc-connection.js not loaded - Remote Connection disabled");
    return;
  }
  
  console.log("Remote Connection enabled");

  var serialReceiveCallback;
  var serialDisconnectCallback;

  function print(txt) {
    Espruino.Core.Terminal.outputDataHandler(txt);
  }

  var getPorts=function(callback) {
    if (webrtc) {
      webrtc.getPorts(callback);
    } else {
      callback([{path:'Remote Connection', description:'Connect with a phone', type : "bluetooth"}], true/*instantPorts*/);
    }
  };

  var openSerial=function(serialPort, openCallback, receiveCallback, disconnectCallback) {
    if (webrtc) {
      webrtc.portConnect(serialPort, function() {
        serialReceiveCallback = receiveCallback;
        serialDisconnectCallback = disconnectCallback;
        openCallback({});
      });
      return;
    }
    var popup;
    webrtc = webrtcInit({
      bridge:false, 
      onStatus : function(s) {
        print(s);
      },
      onPeerID : function(s) {
        var url = window.location.href+"remote?id="+peer.id;
        var qrDiv = document.getElementById("serial_peer_qrcode");
        if (qrDiv==null) {
          qrDiv = document.createElement("div");
          qrDiv.id = "serial_peer_qrcode";
          qrDiv.style = "display:none";
          document.body.append(qrDiv);
        }
        qrDiv.innerHTML = "";
        var qrcode = new QRCode(qrDiv, {
          text: url,
          colorDark : "#ffffff",
          colorLight : "#000000",
          correctLevel : QRCode.CorrectLevel.H
        });
        setTimeout(function() {
          // qrcode doesn't complete immediately and there is no callback
          popup = Espruino.Core.App.openPopup({
            title: "Remote Connection",
            contents: 
`<div style="padding:20px;text-align:center;">
  Please scan the QR code below with your phone or copy/paste the URL to start a connection<br/>
  <div style="padding:20px">${qrDiv.innerHTML}<br/></div><a href="${url}" target="_blank">${url}</a>
</div>`,
            position: "center",
            onClose: function() {
              // cancelled!
              if (popup) openCallback(undefined); // signal failure
              popup = undefined;
            }
          });   
        }, 200);
        //
      },
      onConnected : function() {
        if (popup) {
          popup.close(); // popup.onClose will call openCallback(undefined);
          popup = undefined;
        } 
        setTimeout(() => {
          Espruino.Core.MenuPortSelector.showPortSelector()
        }, 100); // now open the port selector again and we should hopefully see some stuff!
      },
      onPortReceived : function(data) {
        serialReceiveCallback(data);
      },
      onPortDisconnected : function() {
        serialDisconnectCallback();
      }
      });  
    };


    /*


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
    }*/
  


  // ----------------------------------------------------------
  Espruino.Core.Serial.devices.push({
    "name" : "Remote Connection",
    "getPorts": getPorts,
    "open": openSerial,
    "write": function(data, callback) {
      if (!webrtc) return callback();
      webrtc.portWrite(data, callback);
    },
    "close": function(callback) {
      if (!webrtc) return callback();
      if (webrtc) {
        webrtc.portDisconnect(callback);
        webrtc = undefined;
      }
    },
  });
})();
