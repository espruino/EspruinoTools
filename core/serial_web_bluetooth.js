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
var connectionDisconnectCallback;

var txCharacteristic;
var rxCharacteristic;
var txDataQueue = undefined;

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
      callback(['Web Bluetooth']);
    else
      callback();
  };
  
  var openSerial=function(serialPort, openCallback, receiveCallback, disconnectCallback) {
    connectionDisconnectCallback = disconnectCallback;

    var btService;

    navigator.bluetooth.requestDevice({filters:[{services:[ NORDIC_SERVICE ]}]}).then(function(device) {
      console.log('BT>  Device Name:       ' + device.name);
      console.log('BT>  Device InstanceID: ' + device.instanceID);
      console.log('BT>  Device Paired:     ' + device.paired);
      console.log('BT>  Device Class:      ' + device.deviceClass);
      console.log('BT>  Device UUIDs:      ' + device.uuids.join('\n' + ' '.repeat(21)));
      return device.connectGATT();
    }).then(function(server) {
      console.log("BT> Connected");
      btServer = server;  
      return server.getPrimaryService(NORDIC_SERVICE);
    }).then(function(service) {
      console.log("BT> Got service");
      btService = service;
      return btService.getCharacteristic(NORDIC_RX);
    }).then(function (s) {
      rxCharacteristic = s;
      console.log("BT> RX characteristic:"+JSON.stringify(rxCharacteristic));
      rxCharacteristic.addEventListener('characteristicvaluechanged', function(event) {
        var characteristic = event.target;
        var data = ab2str(characteristic.value);
        console.log("BT> RX:"+JSON.stringify(data));
        receiveCallback(data);
      });
      return rxCharacteristic.startNotifications();
    }).then(function() {
      return btService.getCharacteristic(NORDIC_TX);
    }).then(function (s) {
      txCharacteristic = s;
      console.log("BT> TX characteristic:"+JSON.stringify(txCharacteristic));          
    }).then(function() {
      txDataQueue = undefined;
      setTimeout(function() {
        openCallback("All ok");
      }, 500);
    }).catch(error => {
      console.log('BT> ERROR: ' + error);
      if (btServer) {
        // we should have this, but chromebook doesn't seem to 
      if (btServer.disconnect) btServer.disconnect();
        btServer = undefined;
        txCharacteristic = undefined;
        rxCharacteristic = undefined;
      }      
      openCallback(undefined);
    });
  };
 
  var closeSerial=function() {
    if (btServer) {
      // we should have this, but chromebook doesn't seem to 
      if (btServer.disconnect) btServer.disconnect();
      btServer = undefined;
      txCharacteristic = undefined;
      rxCharacteristic = undefined;
    }
    connectionDisconnectCallback();
  };

  // Throttled serial write
  var writeSerial = function(data, callback) {
    if (!txCharacteristic) return; 

    if (typeof txDataQueue != "undefined") {
      txDataQueue += data;
      return callback();
    }

    // TODO: chunk sizes
    txDataQueue = "";
    console.log("BT> Sending "+ JSON.stringify(data));
    try {
      txCharacteristic.writeValue(str2ab(data)).then(function cb() {
        setTimeout(function(){
          console.log("BT> Sent");
          callback();
          if (txDataQueue && txDataQueue.length) {
            txCharacteristic.writeValue(str2ab(txDataQueue)).then(cb);
          }
          txDataQueue = undefined;
        },500); // just throttle write for now
      });
    } catch (e) {
      console.log("BT> ERROR "+e);
      txDataQueue = undefined;
    }
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


