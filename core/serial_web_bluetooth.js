(function() {

// Fix up prefixing
if (typeof navigator == "undefined") return; // not running in a web browser
if (!navigator.bluetooth) {
  console.log("No navigator.bluetooth - Web Bluetooth not enabled");
  return;
}
if (navigator.platform.indexOf("Win")>=0 &&
    (navigator.userAgent.indexOf("Chrome/54")>=0 ||
     navigator.userAgent.indexOf("Chrome/55")>=0 ||
     navigator.userAgent.indexOf("Chrome/56")>=0)
    ) {
  console.log("Web Bluetooth available, but Windows Web Bluetooth is broken in <=56 - not using it");
  return;
}
if (window && window.location && window.location.protocol=="http:") {
  console.log("Serving off HTTP (not HTTPS) - Web Bluetooth not enabled");
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
var txDataQueue = [];
var txInProgress = false;

  function init() {
    /* If BLE is handled some other way (eg winnus), then it
    can be disabled here */
    if (Espruino.Core.Serial.NO_WEB_BLUETOOTH) {
      Espruino.Config.WEB_BLUETOOTH = false;
      return;
    }

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
      callback([{path:'Web Bluetooth', description:'Bluetooth Low Energy', type : "bluetooth"}]);
    else
      callback();
  };

  var openSerial=function(serialPort, openCallback, receiveCallback, disconnectCallback) {
    connectionDisconnectCallback = disconnectCallback;

    var btService;

    navigator.bluetooth.requestDevice({
        filters:[
          { namePrefix: 'Puck.js' },
          { namePrefix: 'Espruino' },
          { services: [ NORDIC_SERVICE ] }
        ], optionalServices: [ NORDIC_SERVICE ]}).then(function(device) {
      Espruino.Core.Status.setStatus("Connecting to "+device.name);
      console.log('BT>  Device Name:       ' + device.name);
      console.log('BT>  Device ID:         ' + device.id);
      // Was deprecated: Should use getPrimaryServices for this in future
      //console.log('BT>  Device UUIDs:      ' + device.uuids.join('\n' + ' '.repeat(21)));
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
        receiveCallback(value.buffer);
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
      txDataQueue = [];
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
    txDataQueue.push({data:data, callback:callback});
    if (txInProgress) return;

    function writeChunk() {
      var chunk;
      var CHUNKSIZE = 20;
      if (!txDataQueue.length) return;
      if (txDataQueue[0].data.length <= CHUNKSIZE) {
        chunk = txDataQueue[0].data;
        txDataQueue[0].data = "";
      } else {
        chunk = txDataQueue[0].data.substr(0,CHUNKSIZE);
        txDataQueue[0].data = txDataQueue[0].data.substr(CHUNKSIZE);
      }
      txInProgress = true;
      console.log("BT> Sending "+ JSON.stringify(chunk));
      txCharacteristic.writeValue(str2ab(chunk)).then(function() {
        console.log("BT> Sent");        
        if (txDataQueue[0].data.length==0) {
          var cb = txDataQueue[0].callback;
          txDataQueue.shift(); // remove the first item
          if (cb) cb();          
        }
        txInProgress = false;
        // if more data, keep sending
        writeChunk();         
      }).catch(function(error) {
       console.log('BT> SEND ERROR: ' + error);
       txDataQueue = [];
       closeSerial();
      });
    }
    writeChunk();
  };

  // ----------------------------------------------------------

  Espruino.Core.Serial.devices.push({
    "name" : "Web Bluetooth",
    "init" : init,
    "getPorts": getPorts,
    "open": openSerial,
    "write": writeSerial,
    "close": closeSerial
  });
})();
