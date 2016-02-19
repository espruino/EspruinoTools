(function() {

// Fix up prefixing
if (typeof navigator == "undefined") return; // not running in a web browser
if (!navigator.bluetooth) {
  console.log("No navigator.bluetooth - Web Bluetooth not enabled");
  return;
}

var NORDIC_SERVICE = "6e400001-b5a3-f393-e0a9-e50e24dcca9e";
var NORDIC_TX = "6e400002-b5a3-f393-e0a9-e50e24dcca9e";
var NORDIC_RX = "6e400003-b5a3-f393-e0a9-e50e24dcca9e";

function ab2str(buf) {
  return String.fromCharCode.apply(null, new Uint8Array(buf));
}

function str2ab(str) {
  var buf = new ArrayBuffer(str.length);
  var bufView = new Uint8Array(buf);
  for (var i=0, strLen=str.length; i<strLen; i++) {
    bufView[i] = str.charCodeAt(i);
  }
  return buf;
}


var btServer = undefined;
var btChecker;
var connectionDisconnectCallback;

var txCharacteristic;
var rxCharacteristic;
var txDataQueue = undefined;
var txInProgress = false;

  function init() {
    Espruino.Core.Config.add("WEB_BLUETOOTH", {
      section : "Communications",
      name : "Connect over Bluetooth Smart (Web Bluetooth)",
      descriptionHTML : 'Allow connection to Espruino via BLE with the Nordic UART implementation',
      type : "boolean",
      defaultValue : true, 
    });
  }  

  var getPorts = function(callback) {
    if (Espruino.Config.WEB_BLUETOOTH)
      callback([{path:'Web Bluetooth', description:'Bluetooth Low Energy'}]);
    else
      callback();
  };
  
  var openSerial=function(serialPort, openCallback, receiveCallback, disconnectCallback) {
    connectionDisconnectCallback = disconnectCallback;

    var btService;
        
    navigator.bluetooth.requestDevice({filters:[{services:[ NORDIC_SERVICE ]}]}).then(function(device) {
      console.log('BT>  Device Name:       ' + device.name);
      console.log('BT>  Device ID: '         + device.id);
      console.log('BT>  Device Paired:     ' + device.paired);
      console.log('BT>  Device Class:      ' + device.deviceClass);
      console.log('BT>  Device UUIDs:      ' + device.uuids.join('\n' + ' '.repeat(21)));
      return device.connectGATT();
    }).then(function(server) {
      console.log("BT> Connected");
      // Check for disconnects
      btChecker = setInterval(function() {
        if (!btServer.connected) {
          clearInterval(btChecker);
          btChecker = undefined;
          console.log("BT> Disconnected");
          disconnectCallback();
        }
      }, 1000);
      btServer = server;  
      // FIXME: Remove this timeout when GattServices property works as intended.
      // crbug.com/560277
      return new Promise(function(resolve) {
        setTimeout(function() {
          resolve(server.getPrimaryService(NORDIC_SERVICE));
        }, 2000);
      })
    }).then(function(service) {
      console.log("BT> Got service");
      btService = service;
      return btService.getCharacteristic(NORDIC_RX);
    }).then(function (s) {
      rxCharacteristic = s;
      console.log("BT> RX characteristic:"+JSON.stringify(rxCharacteristic));
      rxCharacteristic.addEventListener('characteristicvaluechanged', function(event) {
        var value = event.target.value;
        // In Chrome 50+, a DataView is returned instead of an ArrayBuffer.
        value = value.buffer ? value.buffer : value;
        console.log("BT> RX:"+JSON.stringify(ab2str(value)));
        receiveCallback(value);
      });
      return rxCharacteristic.startNotifications();
    }).then(function() {
      return btService.getCharacteristic(NORDIC_TX);
    }).then(function (s) {
      txCharacteristic = s;
      console.log("BT> TX characteristic:"+JSON.stringify(txCharacteristic));          
    }).then(function() {
      txDataQueue = undefined;
      txInProgress = false;
      Espruino.Core.Serial.setSlowWrite(false, true); // hack - leave throttling up to this implementation
      setTimeout(function() {
        openCallback("All ok");
      }, 500);
    }).catch(function(error) {
      console.log('BT> ERROR: ' + error);
      if (btChecker) {
        clearInterval(btChecker);
        btChecker = undefined;
      }
      if (btServer) {        
        if (btServer.disconnect) btServer.disconnect(); // Chromebook doesn't have disconnect?
        btServer = undefined;
        txCharacteristic = undefined;
        rxCharacteristic = undefined;
      }      
      openCallback(undefined);
    });
  };
 
  var closeSerial=function() {
    if (btServer) {
      if (btChecker) {
        clearInterval(btChecker);
        btChecker = undefined;
      }
      if (btServer.disconnect) btServer.disconnect(); // Chromebook doesn't have disconnect?
      btServer = undefined;
      txCharacteristic = undefined;
      rxCharacteristic = undefined;
    }
    connectionDisconnectCallback();
  };

  // Throttled serial write
  var writeSerial = function(data, callback) {
    if (!txCharacteristic) return; 
    if (typeof txDataQueue != "undefined" || txInProgress) {
      if (txDataQueue===undefined) 
        txDataQueue="";
      txDataQueue += data;
      return callback();
    } else {
      txDataQueue = data;
    }

    function writeChunk() {
      var chunk;
      var CHUNKSIZE = 16;
      if (txDataQueue.length <= CHUNKSIZE) {
        chunk = txDataQueue;    
        txDataQueue = undefined;
      } else { 
        chunk = txDataQueue.substr(0,CHUNKSIZE);
        txDataQueue = txDataQueue.substr(CHUNKSIZE);
      }
      txInProgress = true;
      console.log("BT> Sending "+ JSON.stringify(chunk));
      try {
        txCharacteristic.writeValue(str2ab(chunk)).then(function() {
          console.log("BT> Sent");
          txInProgress = false;                
          if (txDataQueue)
            writeChunk();
        });
      } catch (e) {
        console.log("BT> ERROR "+e);
        txDataQueue = undefined;
      }
    }
    writeChunk();
    return callback();
  };
  
  // ----------------------------------------------------------

  Espruino.Core.Serial.devices.push({
    "init" : init,
    "getPorts": getPorts,
    "open": openSerial,
    "write": writeSerial,
    "close": closeSerial
  });
})();


