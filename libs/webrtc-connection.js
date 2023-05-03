/* This is common code for handling connections with WebRTC using Peer.js 
It handles both client and server.

This needs:

EspruinoWebIDE/js/libs/peerjs.min.js

* The 'Bridge' connects direct to Bluetooth/Bangle.js - it is the Client
* The 'Client' (Web IDE) is a server

Protocol:

* Both Bridge and Client have servers
* If the 'Bridge' connects to the 'Client', the Client is immediately sent a {t:"serverId",id:"..."} packet
  * The Client then closes and connects to the Bridge
* When the Client connects to the Bridge, things are working correctly

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

* The Client (IDE) side needs to be able to remember the Bridge's ID and autoconnect
* We need to have repeated retries for the connection
* Clicking top-left in the bridge to pair should automatically disconnect
* When first connecting (eg localStorage/IDE config empty) it may not work correctly? After a refresh it does

*/

var peer;
var callbacks = {};

/* Create a connection:
options = {
  bridge : bool 
     //  true = we're the one communicating with the Bangle
     //  false = we're communicating with the user
  //connectToPeerID : string // if set, we connect to this peer as soon as we start
  onStatus : function(msg) // show status message   
  onPeerID : function(id) // we have a peer ID now
  onConnected : function // a peer has connected
  onGetPorts : function(cb)      // BRIDGE: get port list
  onVideoStream : function(stream) // CLIENT: We have a video stream - display it!
  onPortConnect : function(port, cb) // BRIDGE: start connecting
  onPortDisconnect : function(cb)  // BRIDGE: close active connection
  onPortWrite   : function(data, cb) // BRIDGE: send data
  onPortReceived   : function(data) // CLIENT: Got data from device
  onPortDisconnected : function()   // CLIENT: Port disconnected
  connectVideo : function(stream)   // BRIDGE: Start a video connection with the given medias stream
} 

Return options with extras added:

{
  connect : function(id) // connect to the given peer ID
  connectSendPeerId  : function(id) // BRIDGE: Connect to the client in order to tell it to connect back to us!
  getPorts : function(cb) // get current ports
  portConnect : function(port, cb) // CLIENT: Connect to a device
  portDisconnect : function(cb)    // CLIENT: Disconnect
  onPortDisconnected : function()  // BRIDGE: Signal client was disconnected
  portWrite : function(data, cb)   // CLIENT: Send data
  onPortReceived : function(data)    // BRIDGE: Got data from device

  peerId : "..."  // The peer ID of *this* peer
  connections : [] // list of open connections
  connection : undefined // the current open connection (since we are only supporting one connection right now)
}
*/
function webrtcInit(options) {
  options = options||{};

  options.peerId = null;
  options.connections = [];
  options.connection = undefined; // active connection

  if (!options.bridge &&
      "undefined"!=typeof window &&
      window.localStorage &&
      window.localStorage.getItem("WEBRTC_PEER_ID"))
    options.peerId = window.localStorage.getItem("WEBRTC_PEER_ID");

  peer = new Peer(options.peerId, {
    debug: 2
  });
  peer.on('open', function (id) {
    // Workaround for peer.reconnect deleting previous id
    if (peer.id === null) {
        console.log('[WebRTC] Received null id from peer open');
        peer.id = options.peerId;
    } else {
      options.peerId = peer.id;
        if (!options.bridge &&
          "undefined"!=typeof window &&
          window.localStorage &&
          window.localStorage.setItem("WEBRTC_PEER_ID", peer.id));
    }
    options.peerId = peer.id;

    console.log('[WebRTC] Peer ID: ' + peer.id);
    if (options.onPeerID)
      options.onPeerID(peer.id);
  });
  peer.on('disconnected', function () {
    options.onStatus("Connection lost. Reconnecting...");
    console.log('[WebRTC] Connection lost. Reconnecting....');

    // Workaround for peer.reconnect deleting previous id
    peer.id = options.peerId;
    peer._lastServerId = options.peerId;
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
  peer.on('call', function(call) {    
    if (options.onVideoStream) {
      call.on('stream', function(stream) {
        // `stream` is the MediaStream of the remote peer.
        options.onVideoStream(stream);
      });
      call.on('close', function() {
        // this seems broken https://github.com/peers/peerjs/issues/636
        options.onVideoStream(undefined);
      });
      call.answer(/*mediaStream*/); // answer - not sending a stream back...
    }
  });

  peer.on('connection', function (conn) {
    console.log("[WebRTC] Incoming connection");
    /* If we're a client, we just want to listen for connections
    which will tell us where *we* should connect */
    if (!options.bridge) {
      console.log("[WebRTC] ServerId: We're a client - wait for a serverId packet");
      conn.on('open', function () {
        console.log("[WebRTC] ServerId: Connected to: " + conn.peer);
      });
      conn.on('data', function (data) {        
        if ("object" == typeof data &&
            data.t=="serverId" &&
            data.id) {
          console.log("[WebRTC] ServerId: Got server ID : "+data.id);       
          options.connect(data.id);
        } else 
          console.log("[WebRTC] ServerId: Unknown packet!",data);   
      });
      conn.on('close', function () {
        console.log("[WebRTC] ServerId: Connection closed");
      });  
      return;
    }
    // We're a bridge - handle this connection!
    // Allow only a single connection
    if (options.connection && options.connection.open) {
      conn.on('open', function() {
        console.log("[WebRTC] Already connected to another client - disconnecting");
        conn.send({t:"err",msg:"Already connected to another client"});
        setTimeout(function() { conn.close(); }, 500);
      });
      return;
    }
    console.log("[WebRTC] Connected to: " + conn.peer);
    options.onStatus("Connected to: " + conn.peer);
    if (options.onConnected) options.onConnected();
    webrtcAddHandlers(conn);
  });

  Object.assign(options, { // ============== COMMON
    connect : function(id) {
      console.log("[webRTC] Connecting...");
      var conn = peer.connect(id, {
          reliable: true
      });
      webrtcAddHandlers(conn);
    }
  });

  if (options.bridge) {
    Object.assign(options, { // ============== BRIDGE
      getPorts : function(cb) { // CLIENT
        callbackAddWithTimeout("getPorts", cb, 2000);
        options.connection.send({t:"getPorts"});      
      },
      portConnect : function(port, cb) { // CLIENT
        callbackAddWithTimeout("connect", cb, 2000);
        options.connection.send({t:"connect", port:port});      
      },
      portDisconnect : function(cb) { // CLIENT
        callbackAddWithTimeout("disconnect", cb, 2000);
        options.connection.send({t:"disconnect"});      
      },
      onPortDisconnected : function() { 
        options.connection.send({t:"disconnected"});   
      },
      onPortReceived : function(data) { 
        options.connection.send({t:"received", data});   
      },
      portWrite : function(data, cb) { // CLIENT
        callbackAddWithTimeout("write", cb, 2000);
        options.connection.send({t:"write", data:data});      
      },
      connectVideo : function (stream) {
        if (!webrtc.connections.length) {
          console.log("webrtc.connectVideo no active connections");
          return;
        }
        webrtc.connections.forEach(c => {
          peer.call(c.peer, stream); 
        });
      },
      connectSendPeerId : function(id) {
        console.log("[webRTC] ServerId: Connecting to "+id+" send our ID...");
        var conn = peer.connect(id, {
            reliable: true
        });
        conn.on('open', function () {
          console.log("[WebRTC] ServerId: Connected - send our ID" );
          conn.send( {t:"serverId",id:options.peerId});
          setTimeout(function() {
            console.log("[WebRTC] ServerId: Closing");
            conn.close();
          }, 1000);
        });
      }
    });
  } else {
    Object.assign(options, { // ============== CLIENT
      getPorts : function(cb) { // CLIENT
        callbackAddWithTimeout("getPorts", cb, 2000);
        options.connection.send({t:"getPorts"});      
      },
      portConnect : function(port, cb) { // CLIENT
        callbackAddWithTimeout("connect", cb, 2000);
        options.connection.send({t:"connect", port:port});      
      },
      portDisconnect : function(cb) { // CLIENT
        callbackAddWithTimeout("disconnect", cb, 2000);
        options.connection.send({t:"disconnect"});      
      },
      portWrite : function(data, cb) { // CLIENT
        callbackAddWithTimeout("write", cb, 2000);
        options.connection.send({t:"write", data:data});      
      },
    });
  }

  // ---------------------------------

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
  
  
  
  function webrtcAddHandlers(conn) {
    options.connection = conn; 
    options.connections.push(conn);
    conn.on('open', function () {
      console.log("[WebRTC] Connected to: " + conn.peer);
        //conn.send(command);
      /*if (options.bridge)
        {t:"serverId",id:"..."}*/
    });
    // Handle incoming data (messages only since this is the signal sender)
    conn.on('data', function (data) {
      webrtcDataHandler(conn, data, options);      
    });
    conn.on('close', function () {
      console.log("Connection closed");
      options.connection = undefined;
      var idx = options.connections.indexOf(conn);
      if (idx>=0)
        options.connections.splice(idx,1);
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

  // -----------------------------------------------------
  
  return options;
}


