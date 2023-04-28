/* This is common code for handling connections with WebRTC using Peer.js 
It handles both client and server.

This needs:

EspruinoWebIDE/js/libs/peerjs.min.js

* The 'Bridge' connects direct to Bluetooth/Bangle.js - it is the Server
* The Web IDE is a client

Protocol:

Packets Sent:

{ t : "getPorts" }
-> { t : "getPortsResponse", ports: [ {}, ...] }

{ t : "connect", port : port }
-> { t : "connectResponse" }

-> { t : "disconnected" } // device got disconnected
{ t : "disconnect" }
-> { t : "disconnectResponse" }

{ t : "write", data : data }
-> { t : "writeResponse" }

TODO:

* Add icon for Webcam display - when enabled it should allow forwarding over the peer connection

*/

var peer;
var conn;
var lastPeerId = null;
var callbacks = {};

/* Create a connection:
options = {
  bridge : bool 
     //  true = we're the one communicating with the Bangle
     //  false = we're communicating with the user
  connectToPeerID : string // if set, we connect to this peer as soon as we start
  onStatus : function(msg) // show status message   
  onPeerID : function(id) // we have a peer ID now
  onConnected : function // a peer has connected
  onGetPorts : function(cb)      // BRIDGE: get port list
  onPortConnect : function(port, cb) // BRIDGE: start connecting
  onPortDisconnect : function(cb)  // BRIDGE: close active connection
  onPortWrite   : function(data, cb) // BRIDGE: send data
  onPortReceived   : function(data) // CLIENT: Got data from device
  onPortDisconnected : function()   // CLIENT: Port disconnected
} 

Return options with extras added:

{
  send : function(d) // send characters
  getPorts : function(cb) // get current ports
  portConnect : function(port, cb) // CLIENT: Connect to a device
  portDisconnect : function(cb)    // CLIENT: Disconnect
  onPortDisconnected : function()  // BRIDGE: Signal client was disconnected
  portWrite : function(data, cb)   // CLIENT: Send data
  onPortReceived : function(data)    // BRIDGE: Got data from device
}
*/
function webrtcInit(options) {
  options = options||{};

  if (!options.bridge &&
      "undefined"!=typeof window &&
      window.localStorage &&
      window.localStorage.getItem("WEBRTC_PEER_ID"))
    lastPeerId = window.localStorage.getItem("WEBRTC_PEER_ID");

  peer = new Peer(lastPeerId, {
    debug: 2
  });
  peer.on('open', function (id) {
      // Workaround for peer.reconnect deleting previous id
      if (peer.id === lastPeerId) {
          console.log('Received null id from peer open');
          peer.id = lastPeerId;
      } else {
          lastPeerId = peer.id;
          if (!options.bridge &&
            "undefined"!=typeof window &&
            window.localStorage &&
            window.localStorage.setItem("WEBRTC_PEER_ID", peer.id));
      }

      console.log('[WebRTC] Peer ID: ' + peer.id);
      if (options.onPeerID)
        options.onPeerID(peer.id);

      webrtcConnect(options);
  });
  peer.on('disconnected', function () {
      options.onStatus("Connection lost. Reconnecting...");
      console.log('[WebRTC] Connection lost. Reconnecting....');

      // Workaround for peer.reconnect deleting previous id
      peer.id = lastPeerId;
      peer._lastServerId = lastPeerId;
      peer.reconnect();
  });
  peer.on('close', function() {
      conn = null;
      options.onStatus("Connection destroyed. Please refresh");
      console.log('Connection destroyed');
  });
  peer.on('error', function (err) {
      console.log(err);
      options.onStatus("ERROR: "+err);
  });

  peer.on('connection', function (c) {
    console.log("[WebRTC] Incoming connection");
    // Allow only a single connection
    if (conn && conn.open) {
        c.on('open', function() {
          console.log("[WebRTC] Already connected to another client - disconnecting");
          c.send({t:"err",msg:"Already connected to another client"});
          setTimeout(function() { c.close(); }, 500);
        });
        return;
    }

    conn = c;
    console.log("[WebRTC] Connected to: " + conn.peer);
    options.onStatus("Connected to: " + conn.peer);
    if (options.onConnected) options.onConnected();
    webrtcAddHandlers(conn, options);
  });
/*
  Object.assign(options, { // ============== COMMON
    send : function(d) {
      if (conn) conn.send({t:"send", data:d});
    },
  });*/

  if (options.bridge) {
    Object.assign(options, { // ============== BRIDGE
      getPorts : function(cb) { // CLIENT
        callbackAddWithTimeout("getPorts", cb, 2000);
        conn.send({t:"getPorts"});      
      },
      portConnect : function(port, cb) { // CLIENT
        callbackAddWithTimeout("connect", cb, 2000);
        conn.send({t:"connect", port:port});      
      },
      portDisconnect : function(cb) { // CLIENT
        callbackAddWithTimeout("disconnect", cb, 2000);
        conn.send({t:"disconnect"});      
      },
      onPortDisconnected : function() { 
        conn.send({t:"disconnected"});   
      },
      onPortReceived : function(data) { 
        conn.send({t:"received", data});   
      },
      portWrite : function(data, cb) { // CLIENT
        callbackAddWithTimeout("write", cb, 2000);
        conn.send({t:"write", data:data});      
      },
    });
  } else {
    Object.assign(options, { // ============== CLIENT
      getPorts : function(cb) { // CLIENT
        callbackAddWithTimeout("getPorts", cb, 2000);
        conn.send({t:"getPorts"});      
      },
      portConnect : function(port, cb) { // CLIENT
        callbackAddWithTimeout("connect", cb, 2000);
        conn.send({t:"connect", port:port});      
      },
      portDisconnect : function(cb) { // CLIENT
        callbackAddWithTimeout("disconnect", cb, 2000);
        conn.send({t:"disconnect"});      
      },
      portWrite : function(data, cb) { // CLIENT
        callbackAddWithTimeout("write", cb, 2000);
        conn.send({t:"write", data:data});      
      },
    });
  }
  
  return options;
}


function callbackAddWithTimeout(id, cb, timeout) {
  callbacks[id] = cb;
  // TODO: timeout?
}
function callbackCall(id, data) {
  if (callbacks[id])
    callbacks[id](data);
  callbacks[id] = undefined;
  // TODO: timeout?
}

/* Create a connection:
options = {
  peerId
} */
function webrtcConnect(options) {
  options = options||{};
  if (options.connectToPeerID===null) {
    console.log("No Peer ID specified!");
    console.log("Please launch this page from the QR Code or Link in the Web IDE");
    return;
  }
  if (conn) conn.close(); // close old
  console.log("Connecting...");
  conn = peer.connect(options.connectToPeerID, {
      //reliable: true
  });
  webrtcAddHandlers(conn, options);
}

function webrtcAddHandlers(conn, options) {
  conn.on('open', function () {
    console.log("Connected to: " + conn.peer);
      //conn.send(command);
  });
  // Handle incoming data (messages only since this is the signal sender)
  conn.on('data', function (data) {
    webrtcDataHandler(conn, data, options);      
  });
  conn.on('close', function () {
    console.log("Connection closed");
  });  
}


function webrtcDataHandler(conn, data, options) {
  console.log("[webrtc] data " + JSON.stringify(data));
  if ("object" != typeof data) return;
  if (options.bridge) switch (data.t) { // ================= BRIDGE
    case "getPorts" : // BRIDGE
      options.onGetPorts(ports => {        
        conn.send({t:"getPortsResponse", ports:ports});
      });
      break;
    case "connect" : // BRIDGE
      options.onPortConnect(data.port, () => {        
        conn.send({t:"connectResponse"});
      });
      break;
    case "disconnect" : // BRIDGE
      options.onPortDisconnect(data.port, () => {        
        conn.send({t:"disconnectResponse"});
      });
      break;
    case "write" : // BRIDGE
      options.onPortWrite(data.data, () => {        
        conn.send({t:"writeResponse"});
      });
      break;
  } else switch (data.t) { // ======================CLIENT
    case "getPortsResponse" : // CLIENT
      data.ports.forEach(port => {
        // TODO set port.type so we get a different icon?
        if (port.description)
          port.description = "REMOTE: "+port.description;
      });
      callbackCall("getPorts", data.ports);
      break;  
    case "connectResponse" : // CLIENT
      callbackCall("connect");
      break;  
    case "disconnected" : // CLIENT
      options.onPortDisconnected();
      break;       
    case "disconnectResponse" : // CLIENT
      callbackCall("disconnect");
      break;     
    case "writeResponse" : // CLIENT
      callbackCall("write");
      break;     
    case "received" : // CLIENT
      options.onPortReceived(data.data);
      break;        
  }  
}