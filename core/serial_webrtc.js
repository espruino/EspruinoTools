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
  var popup; // popup window from showPairingPopup that goes away when the Bridge connects

  function print(txt) {
    Espruino.Core.Terminal.outputDataHandler(txt);
  }

  webrtc = webrtcInit({
    bridge:false, 
    onStatus : function(s) {
      print(s);
    },
    onPeerID : function(s) {
      
      //
    },
    onVideoStream : function(stream) {
      if (stream) Espruino.Config.set("SHOW_WEBCAM_ICON", 1); // force webcam icon
      Espruino.Plugins.Webcam.displayMediaStream(stream);
    },
    onConnected : function() {
      // peer connected, remove the popupa and show the port selector
      if (popup) {
        popup.close(); // popup.onClose will call openCallback(undefined);
        popup = undefined;
      } 
      setTimeout(() => {
        Espruino.Core.MenuPortSelector.showPortSelector()
      }, 100); // now open the port selector again and we should hopefully see some stuff!
    },
    onPortReceived : function(data) {
      serialReceiveCallback(Espruino.Core.Utils.stringToArrayBuffer(data));
    },
    onPortDisconnected : function() {
      serialDisconnectCallback();
    }
    });  

  var getPorts=function(callback) {
    if (webrtc.connections.length) {
      // If we have a connection, great - use it to get ports
      webrtc.getPorts(callback);
    } else if (webrtc.peerId) {
      // If no connection, pop up an option to enable it which we will handle in openSerial
      callback([{path:'Remote Connection', description:'Connect via another device', type : "bluetooth"}], true/*instantPorts*/);
    } else
      callback([]); // peer connection failed - ignore this
  };

  function showPairingPopup() {
    var url = window.location.href+"remote?id="+webrtc.peerId;
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
          popup = undefined;
        }
      });   
    }, 200);
  }

  var openSerial=function(serialPort, openCallback, receiveCallback, disconnectCallback) {
    if (!webrtc.connections.length) { // we're not connected
      openCallback(undefined); // cancel the connection
      // Create a popup with the QR code
      if (webrtc.peerId)
        showPairingPopup();
      return;
    }
    // All ok - forward our connection!
    webrtc.portConnect(serialPort, function() {
      serialReceiveCallback = receiveCallback;
      serialDisconnectCallback = disconnectCallback;
      openCallback({});
    });
  };

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
