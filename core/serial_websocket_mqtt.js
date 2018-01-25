/*
Gordon Williams (gw@pur3.co.uk)

MQTT over WebSockets, using Paho MQTT: http://www.eclipse.org/paho/files/jsdoc/index.html

Designed for use with https://github.com/espruino/EspruinoHub and the MQTT
messages it creates.
*/

(function() {
  if (typeof window == "undefined" || typeof WebSocket == undefined) return;
  console.log("WebSocket MQTT support enabled - running in web browser");
  
  function init() {
    // Try and connect right away - it makes the connection window snappier
    websocketConnect();
    // Check for old devices and remove them from the list
    setInterval(function() {
      for (var i=0;i<foundDevices.length;i++) {
        if (foundDevices[i].path == deviceAddress)
          continue; // we're connected
        if (++foundDevices[i].age > 5) {
          foundDevices.splice(i,1);
          i--;
        }
      }
    }, 2000);
  }
  
  function websocketConnect() {
    // for now, always connect to where we were served from
    var serverName = location.hostname;
    var serverPort = parseInt(location.port);    
    
    console.log("Websockets> Connecting to "+serverName+":"+serverPort);
    websocket = new Paho.MQTT.Client(serverName, serverPort, "espruino");
    websocket.onConnectionLost = function (responseObject) {
      websocket = undefined;
      console.log("Websockets> Connection Lost:"+responseObject.errorMessage);
      closeSerial();
    };
    // called when a message arrives
    websocket.onMessageArrived = function(message) {
      if (deviceAddress && message.destinationName == "/ble/data/"+deviceAddress+"/nus/nus_rx") {
        // Receive data from device
        if (rcb) rcb(str2ab(message.payloadString));
      } else if (deviceAddress && message.destinationName == "/ble/pong/"+deviceAddress) {
        // When we get a 'pong' back, call this - so we know we're connected
        if (onPong) onPong();
        onPong = undefined;
      } else if (message.destinationName.substr(0,15)=="/ble/advertise/") {
        // advertising for new devices
        var address = message.destinationName.substr(15);
        try {
          var j = JSON.parse(message.payloadString);
          if (j.name && Espruino.Core.Utils.isRecognisedBluetoothDevice(j.name)) {
            var dev = foundDevices.find(dev => dev.path==address);
            if (!dev) {
              dev = {
                age : 0,
                description : j.name,
                path : address,
                type : "bluetooth",
              };
              foundDevices.push(dev);
              console.log("Websockets> found new device "+JSON.stringify(j.name)+" ("+address+")");
            } else {
              dev.age = 0;
            }
          }
        } catch (e) {
          console.log("Websockets> Malformed JSON from "+message.destinationName);
        }
      } else {
        console.log("Websockets> onMessageArrived:"+message.destinationName+" "+message.payloadString);
      }
    };
    websocket.connect({onSuccess:function() {
      console.log("Websockets> Connected");
      // Subscribe to advertising data
      websocket.subscribe("/ble/advertise/+");
    }});
  }

  var foundDevices = [];
  var deviceAddress;
  var websocket;
  var pingInterval;
  var onPong;
  // callbacks
  var rcb, dcb;
  
  var getPorts = function(callback) {
    if (websocket==undefined)
      websocketConnect();
    callback(foundDevices);
  };
  
  var str2ab = function(str) {
    var buf=new ArrayBuffer(str.length);
    var bufView=new Uint8Array(buf);
    for (var i=0; i<str.length; i++) {
      bufView[i]=str.charCodeAt(i);
    }
    return buf;
  };

  var openSerial=function(serialPort, openCallback, receiveCallback, disconnectCallback) {
    if (!websocket) {
      console.log("Websockets> Not Connected");
      disconnectCallback();
    }
    deviceAddress = serialPort;
    rcb = receiveCallback;
    dcb = disconnectCallback;
    
    // When we get a pong, say that we're connected
    onPong = function() {
      if (connectionTimeout) {
        clearTimeout(connectionTimeout);
        connectionTimeout = undefined;
      }
      openCallback({ all : "ok" });
      onPong = undefined;
    };
    // 10 second connection timeout
    var connectionTimeout = setTimeout(function() {
      connectionTimeout = undefined;
      console.log("Websockets> Connection timeout");
      closeSerial();
    }, 10000);
    // Subscribe to data 
    websocket.subscribe("/ble/data/"+deviceAddress+"/nus/nus_rx");
    websocket.subscribe("/ble/pong/"+deviceAddress);
    // request notifications of serial RX
    sendMessage("/ble/notify/"+deviceAddress+"/nus/nus_rx","");
    // send a ping so when we get a pong we know we're connected
    sendMessage("/ble/ping/"+deviceAddress+"", "");
    // keep pinging so the connection doesn't close
    pingInterval = setInterval(function() {
      sendMessage("/ble/ping/"+deviceAddress+"", "");
    }, 3000);
  };
  
  function sendMessage(topic, msg) {
    if (!websocket) {
      console.log("sendMessage when not connected");
      return;
    }
    var message = new Paho.MQTT.Message(JSON.stringify(msg));
    message.destinationName = topic;
    websocket.send(message);
  }
  
  var closeSerial = function() {
    if (pingInterval) {
      clearInterval(pingInterval);
      pingInterval = undefined;
    }
    if (websocket && deviceAddress) {
      websocket.unsubscribe("/ble/data/"+deviceAddress+"/nus/nus_rx");
      websocket.unsubscribe("/ble/pong/"+deviceAddress);
    }
    deviceAddress = undefined;
    if (dcb) dcb();      
    dcb = rcb = undefined;
  };
  
  var writeSerial = function(data, callback) {
    if (!deviceAddress) return;
    sendMessage("/ble/write/"+deviceAddress+"/nus/nus_tx", data);
    setTimeout(callback, 100); // force a delay when sending data
  };
  
  Espruino.Core.Serial.devices.push({
    "name" : "MQTT over Websockets",
    "init" : init,
    "getPorts": getPorts,
    "open": openSerial,
    "write": writeSerial,
    "close": closeSerial,
  });
})();
