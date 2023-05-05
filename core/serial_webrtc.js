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
  if (typeof webrtcInit == "undefined") {
    console.log("libs/webrtc-connection.js not loaded - Remote Connection disabled");
    return;
  }
  
  console.log("Remote Connection enabled");

  var webrtc; // Our WebRTC connection
  var serialReceiveCallback;
  var serialDisconnectCallback;
  var popup; // popup window from showPairingPopup that goes away when the Bridge connects

  function init() {
    Espruino.Core.Config.add("WEBRTC_BRIDGE_ID", {
      section : "Communications",
      name : "Remote Connection Bridge Peer ID",
      descriptionHTML : 'The Bridge\'s Peer ID from  <a href="https://www.espruino.com/ide/remote" target="_blank">espruino.com/ide/remote</a> on another device, or Gadgetbridge. You\'ll then be able to use the Web IDE to communicate with a device via the Bridge. Leave blank to disable.',
      type : "string",
      defaultValue : ""
    });
  }

  function initWebRTC(callback) {
    webrtc = webrtcInit({
      bridge:false, 
      connectToPeerID : Espruino.Config.WEBRTC_BRIDGE_ID ? Espruino.Config.WEBRTC_BRIDGE_ID.trim() : undefined,
      onStatus : function(s) {
        console.log("[WebRTC Status] "+s);
        // we were using Espruino.Core.Terminal.outputDataHandler(s+"\n");
      },
      onPeerID : function(id) {      
        // we have our Peer ID
        if (!Espruino.Config.WEBRTC_BRIDGE_ID && callback) {
          callback(id);
          callback = undefined;
        }
      },
      onBridgePeerID : function(id) {      
        // We got the bridge's peer ID - save it
        Espruino.Config.set("WEBRTC_BRIDGE_ID", id); // force webcam icon
      },
      onVideoStream : function(stream) {
        console.log("[WebRTC onVideoStream] "+(stream?"enabled":"disabled"));
        if (stream) Espruino.Config.set("SHOW_WEBCAM_ICON", 1); // force webcam icon
        if (Espruino.Plugins.Webcam)
          Espruino.Plugins.Webcam.displayMediaStream(stream);
      },
      onPeerConnected : function() {
        if (Espruino.Config.WEBRTC_BRIDGE_ID && callback) {
          callback();
        }
        // peer connected, remove the popup and show the port selector
        if (popup) {
          popup.close(); // popup.onClose will call openCallback(undefined);
          popup = undefined;
        } 
        setTimeout(() => {
          // we might be running as a CLI
          if (Espruino.Core.MenuPortSelector) 
            Espruino.Core.MenuPortSelector.showPortSelector()
        }, 100); // now open the port selector again and we should hopefully see some stuff!
      },
      onPeerDisconnected : function() {
        // peer disconnected so show connection dropped
        if (serialDisconnectCallback) serialDisconnectCallback();
        if (Espruino.Plugins.Webcam)
          Espruino.Plugins.Webcam.displayMediaStream(undefined);
      },
      onPortReceived : function(data) {
        if (serialReceiveCallback)
          serialReceiveCallback(Espruino.Core.Utils.stringToArrayBuffer(data));
      },
      onPortDisconnected : function() {
        if (serialDisconnectCallback) serialDisconnectCallback();
      }
    });  
  }

  var getPorts=function(callback) {
    if (webrtc && webrtc.connections.length) {
      // If we have a connection, great - use it to get ports
      webrtc.getPorts(ports => {
        callback(ports, false/*not immediate*/)
      });
    } else {
      if (!webrtc && Espruino.Config.WEBRTC_BRIDGE_ID)
        initWebRTC(function() {
          callback([], false);
        });
      else
       callback([]); // peer connection failed - ignore this
    }
  };

  // called once we're sure we have a peer ID
  function showPairingPopupWithID() {
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
      colorDark : "#000000",
      colorLight : "#ffffff",
      correctLevel : QRCode.CorrectLevel.H
    });
    setTimeout(function() {
      // qrcode doesn't complete immediately and there is no callback
      popup = Espruino.Core.App.openPopup({
        title: "Remote Connection",
        contents: 
`<div style="padding:20px;text-align:center;">
Please scan the QR code below with your phone or copy/paste the URL to start a connection<br/>
<div style="padding:20px">${qrDiv.innerHTML}<br/></div><a href="${url}" target="_blank" style="word-break: break-all;">${url}</a>
</div>`,
        position: "center",
        onClose: function() {
          popup = undefined;
        }
      });   
    }, 200);
  }

  // Initialise WebRTC if needed, and show the popup window
  function showPairingPopup() {
    if (webrtc) showPairingPopupWithID();
    else initWebRTC(showPairingPopupWithID);
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
    init : init,
    showPairingPopup : showPairingPopup,
    initWebRTC : function(callback) {
      if (!webrtc) initWebRTC(callback);
      else callback();
    }
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
