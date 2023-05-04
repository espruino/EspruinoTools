/*
Gordon Williams (gw@pur3.co.uk)

Remote connections using Peer.js

Needs:

libs/webrtc-connection.js
EspruinoWebIDE/js/libs/qrcode.min.js

TODO:

Do we want a way to cancel the remote connection once it is set up?

*/
(function() {

  var webrtc; // Our WebRTC connection

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

  webrtc = webrtcInit({
    bridge:false, 
    onStatus : function(s) {
      console.log("[WebRTC Status] "+s);
      // we were using Espruino.Core.Terminal.outputDataHandler(s+"\n");
    },
    onPeerID : function(id) {      
      // we have our Peer ID
    },
    onVideoStream : function(stream) {
      if (stream) Espruino.Config.set("SHOW_WEBCAM_ICON", 1); // force webcam icon
      Espruino.Plugins.Webcam.displayMediaStream(stream);
    },
    onConnected : function() {
      // peer connected, remove the popup and show the port selector
      if (popup) {
        popup.close(); // popup.onClose will call openCallback(undefined);
        popup = undefined;
      } 
      setTimeout(() => {
        Espruino.Core.MenuPortSelector.showPortSelector()
      }, 100); // now open the port selector again and we should hopefully see some stuff!
    },
    onPortReceived : function(data) {
      if (serialReceiveCallback)
        serialReceiveCallback(Espruino.Core.Utils.stringToArrayBuffer(data));
    },
    onPortDisconnected : function() {
      if (serialDisconnectCallback) serialDisconnectCallback();
    }
    });  

  var getPorts=function(callback) {
    if (webrtc && webrtc.connections.length) {
      // If we have a connection, great - use it to get ports
      webrtc.getPorts(callback);
    } else
      callback([]); // peer connection failed - ignore this
  };

  function showPairingPopup() {
    var url = window.location.origin + window.location.pathname + "remote?id=" + webrtc.peerId;
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
    webrtc.portConnect(serialPort, function() {
      serialReceiveCallback = receiveCallback;
      serialDisconnectCallback = disconnectCallback;
      openCallback({});
    });
  };

  // ----------------------------------------------------------
  Espruino.Core.RemoteConnection = {
    showPairingPopup : showPairingPopup
  };
  Espruino.Core.Serial.devices.push({
    "name" : "Remote Connection",
    "getPorts": getPorts,
    "open": openSerial,
    "write": function(data, callback) {
      if (!webrtc) return callback();
      webrtc.portWrite(data, callback);
    },
    "close": function(callback) {
      if (webrtc)
        webrtc.portDisconnect(callback);
      else
        return callback();
    },
  });
})();
