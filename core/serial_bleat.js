(function() {

/* On Linux, BLE normnally needs admin right to be able to access BLE
 * 
 * sudo apt-get install libcap2-bin
 * sudo setcap 'cap_net_raw,cap_net_admin+eip'  /usr/bin/nodejs
 */   
  
  if (typeof require === 'undefined') return;
  var bleat = undefined;
  try {
    bleat = require('bleat');
    if (bleat.classic) bleat = bleat.classic;
  } catch (e) {
    console.error(e);
    console.log("`bleat` module not loaded - no node.js Bluetooth Low Energy");
    return;
  }

var NORDIC_SERVICE = "6e400001-b5a3-f393-e0a9-e50e24dcca9e";
var NORDIC_TX = "6e400002-b5a3-f393-e0a9-e50e24dcca9e";
var NORDIC_RX = "6e400003-b5a3-f393-e0a9-e50e24dcca9e";

var initialised = false;
function checkInit(callback) {
  if (initialised || !bleat.init) callback(null);
  else {
    bleat.init(function() {
      console.log("bleat initialised");
      initialised = true;
      callback(null);
    }, function(err) {
      console.error("bleat error:", err);
      callback(err);
    });
  }    
}

function ab2str(buf) {
  return String.fromCharCode.apply(null, new Uint8Array(buf));
}

function str2abv(str) {
  var bufView = new Uint8Array(str.length);
  for (var i=0; i<bufView.length; i++) {
    bufView[i] = str.charCodeAt(i);
  }
  return bufView;
}

function dataview2ab(dv) {
  var bufView = new Uint8Array(dv.byteLength);
  for (var i=0;i<bufView.length; i++) {
    bufView[i] = dv.getUint8(i);
  }
  return bufView.buffer;
}

// map of bluetooth devices found by getPorts
var btDevices = {};

var btDevice;
var txCharacteristic;
var rxCharacteristic;
var txDataQueue = undefined;
var txInProgress = false;

  function init() {
    Espruino.Core.Config.add("BLUETOOTH_LOW_ENERGY", {
      section : "Communications",
      name : "Connect over Bluetooth Smart (BTLE) via 'bleat'",
      descriptionHTML : 'Allow connection to Espruino via BLE with the Nordic UART implementation',
      type : "boolean",
      defaultValue : true, 
    });    
  }  

  var getPorts = function(callback) {
    if (!Espruino.Config.BLUETOOTH_LOW_ENERGY) {
      callback([]);
    } else {
      checkInit(function(err) {
        if (err) return callback([]);
        var devices = [];
//        btDevices = {};
        console.log("bleat scanning");
        bleat.startScan(function(dev) {
          if (dev.serviceUUIDs.indexOf(NORDIC_SERVICE)>=0) {
            console.log("Found UART device:", dev);            
            devices.push({path:dev.address, description: dev.name});
            btDevices[dev.address] = dev;
          } else console.log("Found device:", dev);
        });
        setTimeout(function() {
          console.log("bleat stopping scan");
          bleat.stopScan();
          callback(devices);
        }, 1500);
      });
    }
  };
  
  var openSerial=function(serialPort, openCallback, receiveCallback, disconnectCallback) {
    var device = btDevices[serialPort];
    if (device===undefined) throw "BT device not found"

    console.log("BT> Connecting");
    device.connect(function() {
      btDevice = device;
      console.log("BT> Connected");
      // connected
      var service = device.services[NORDIC_SERVICE];
      rxCharacteristic = service.characteristics[NORDIC_RX];
      txCharacteristic = service.characteristics[NORDIC_TX];

      rxCharacteristic.enableNotify(function(data) {
        if (data instanceof DataView) {
          // Bleat API changes between versions :(
          data = dataview2ab(data);
        }
        console.log("BT> RX:"+JSON.stringify(ab2str(data)));
        receiveCallback(data);
      }, function() {
        // complete
        txDataQueue = undefined;
        txInProgress = false;
        openCallback({});
      });      
    }, function() {
      // disconnected
      console.log("BT> Disconnected");
      btDevice = undefined;
      rxCharacteristic = undefined;
      txCharacteristic = undefined;
      disconnectCallback();
    });    
  };
 
  var closeSerial=function() {
    if (btDevice) {
      btDevice.disconnect(); // should call disconnect callback?
    }
  };

  // Throttled serial write
  var writeSerial = function(data, callback) {
    if (txCharacteristic === undefined) return; 
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
        txCharacteristic.write(str2abv(chunk), function() {
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


