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

    // Ideally we could do {filters:[{services:[ NORDIC_SERVICE ]}]}, but it seems that
    // on MacOS there are some problems requesting based on service...
    // https://bugs.chromium.org/p/chromium/issues/detail?id=630598
    navigator.bluetooth.requestDevice({
        filters:[
          { namePrefix: 'Puck.js' },
          { namePrefix: 'Espruino' }
        ], optionalServices: [ NORDIC_SERVICE ]}).then(function(device) {
      Espruino.Core.Status.setStatus("Connecting to "+device.name);
      console.log('BT>  Device Name:       ' + device.name);
      console.log('BT>  Device ID:         ' + device.id);
      console.log('BT>  Device UUIDs:      ' + device.uuids.join('\n' + ' '.repeat(21)));
      device.addEventListener('gattserverdisconnected', function() {
        console.log("BT> Disconnected (gattserverdisconnected)");
        closeSerial();
      });
      return device.gatt.connect();
    }).then(function(server) {
      Espruino.Core.Status.setStatus("Connected to BLE");
      console.log("BT> Connected");
      btServer = server;
      return server.getPrimaryService(NORDIC_SERVICE);
    }).then(function(service) {
      Espruino.Core.Status.setStatus("Configuring BLE...");
      console.log("BT> Got service");
      btService = service;
      return btService.getCharacteristic(NORDIC_RX);
    }).then(function (characteristic) {
      Espruino.Core.Status.setStatus("Configuring BLE....");
      rxCharacteristic = characteristic;
      console.log("BT> RX characteristic:"+JSON.stringify(rxCharacteristic));
      rxCharacteristic.addEventListener('characteristicvaluechanged', function(event) {
        // In Chrome 50+, a DataView is returned instead of an ArrayBuffer.		
        var value = event.target.value.buffer;
        console.log("BT> RX:"+JSON.stringify(ab2str(value)));
        receiveCallback(value);
      });
      return rxCharacteristic.startNotifications();
    }).then(function() {
      Espruino.Core.Status.setStatus("Configuring BLE....");
      return btService.getCharacteristic(NORDIC_TX);
    }).then(function (characteristic) {
      Espruino.Core.Status.setStatus("Configuring BLE.....");
      txCharacteristic = characteristic;
      console.log("BT> TX characteristic:"+JSON.stringify(txCharacteristic));
    }).then(function() {
      Espruino.Core.Status.setStatus("Configuring BLE.....");
      txDataQueue = undefined;
      txInProgress = false;
      Espruino.Core.Serial.setSlowWrite(false, true); // hack - leave throttling up to this implementation
      setTimeout(function() {
        Espruino.Core.Status.setStatus("BLE configured. Receiving data...");
        openCallback("All ok");
      }, 500);
    }).catch(function(error) {
      console.log('BT> ERROR: ' + error);
      if (btServer) {
        btServer.disconnect();
        btServer = undefined;
        txCharacteristic = undefined;
        rxCharacteristic = undefined;
      }
      disconnectCallback(undefined);
    });
  };

  var closeSerial=function() {
    if (btServer) {
      btServer.disconnect();
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
      txCharacteristic.writeValue(str2ab(chunk)).then(function() {
        console.log("BT> Sent");
        txInProgress = false;
        if (txDataQueue)
          writeChunk();
      }).catch(function(error) {
       console.log('BT> SEND ERROR: ' + error);
       txDataQueue = undefined;
       closeSerial();
      });
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
