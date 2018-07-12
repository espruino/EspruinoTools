(function() {

  // Fix up prefixing
  if (typeof navigator == "undefined") {
    console.log("Not running in a browser - Web Bluetooth not enabled");
    return;
  }

  function checkCompatibility() {
    if (!navigator.bluetooth) {
      console.log("No navigator.bluetooth - Web Bluetooth not enabled");
      return false;
    }
    if (navigator.bluetooth.requestDevice &&
        navigator.bluetooth.requestDevice.toString().indexOf('callExtension') >= 0) {
      console.log("Using Urish's Windows 10 Web Bluetooth Polyfill");
    } else if (navigator.platform.indexOf("Win")>=0 &&
        (navigator.userAgent.indexOf("Chrome/")>=0)) {
      var chromeVer = navigator.userAgent.match(/Chrome\/(\d+)/);
      if (chromeVer && chromeVer[1]<68) {
        console.log("Web Bluetooth available, but Windows Web Bluetooth is broken in <68 - not using it");
        return false;
      }
    }
    if (window && window.location && window.location.protocol=="http:") {
      console.log("Serving off HTTP (not HTTPS) - Web Bluetooth not enabled");
      return false;
    }
    return true;
  }

  var WEB_BLUETOOTH_OK = true;
  var NORDIC_SERVICE = "6e400001-b5a3-f393-e0a9-e50e24dcca9e";
  var NORDIC_TX = "6e400002-b5a3-f393-e0a9-e50e24dcca9e";
  var NORDIC_RX = "6e400003-b5a3-f393-e0a9-e50e24dcca9e";
  var NORDIC_TX_MAX_LENGTH = 20;
  var testedCompatibility = false;

  var btServer = undefined;
  var connectionDisconnectCallback;

  var txCharacteristic;
  var rxCharacteristic;
  var txInProgress = false;

  function init() {
    /* If BLE is handled some other way (eg winnus), then it
    can be disabled here */
    if (Espruino.Core.Serial.NO_WEB_BLUETOOTH) {
      WEB_BLUETOOTH_OK = false;
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

  function getPorts(callback) {
    if (!testedCompatibility) {
      testedCompatibility = true;
      /* Check compatibility here - the Web Bluetooth Polyfill for windows
      loads after everything else, so we can't check when this page is
      parsed.*/
      if (!checkCompatibility())
        WEB_BLUETOOTH_OK = false;
    }
    if (Espruino.Config.WEB_BLUETOOTH && WEB_BLUETOOTH_OK)
      callback([{path:'Web Bluetooth', description:'Bluetooth Low Energy', type : "bluetooth"}], true/*instantPorts*/);
    else
      callback(undefined, true/*instantPorts*/);
  }

  function openSerial(serialPort, openCallback, receiveCallback, disconnectCallback) {
    connectionDisconnectCallback = disconnectCallback;

    var btService;
    var deviceName;

    var filters = [];
    Espruino.Core.Utils.recognisedBluetoothDevices().forEach(function(namePrefix) {
      filters.push({ namePrefix: namePrefix });
    });
    filters.push({ services: [ NORDIC_SERVICE ] });

    navigator.bluetooth.requestDevice({
        filters: filters,
        optionalServices: [ NORDIC_SERVICE ]}).then(function(device) {

      deviceName = device.name;
      Espruino.Core.Status.setStatus("Connecting to "+device.name);
      console.log('BT>  Device Name:       ' + device.name);
      console.log('BT>  Device ID:         ' + device.id);
      // Was deprecated: Should use getPrimaryServices for this in future
      //console.log('BT>  Device UUIDs:      ' + device.uuids.join('\n' + ' '.repeat(21)));
      device.addEventListener('gattserverdisconnected', function() {
        console.log("BT> Disconnected (gattserverdisconnected)");
        closeSerial();
      }, {once:true});
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
        //console.log("BT> RX:"+JSON.stringify(Espruino.Core.Utils.arrayBufferToString(value)));
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
      txInProgress = false;
      Espruino.Core.Serial.setSlowWrite(false, true); // hack - leave throttling up to this implementation
      setTimeout(function() {
        Espruino.Core.Status.setStatus("BLE configured. Receiving data...");
        openCallback({ portName : deviceName });
      }, 500);
    }).catch(function(error) {
      console.log('BT> ERROR: ' + error);
      if (btServer) {
        btServer.disconnect();
        btServer = undefined;
        txCharacteristic = undefined;
        rxCharacteristic = undefined;
      }
      if (connectionDisconnectCallback) {
        connectionDisconnectCallback(undefined);
        connectionDisconnectCallback = undefined;
      }
    });
  }

  function closeSerial() {
    if (btServer) {
      btServer.disconnect();
      btServer = undefined;
      txCharacteristic = undefined;
      rxCharacteristic = undefined;
    }
    if (connectionDisconnectCallback) {
      connectionDisconnectCallback();
      connectionDisconnectCallback = undefined;
    }
  }

  // Throttled serial write
  function writeSerial(data, callback) {
    if (!txCharacteristic) return;

    if (data.length>NORDIC_TX_MAX_LENGTH) {
      console.error("BT> TX length >"+NORDIC_TX_MAX_LENGTH);
      return callback();
    }
    if (txInProgress) {
      console.error("BT> already sending!");
      return callback();
    }

    txInProgress = true;
    txCharacteristic.writeValue(Espruino.Core.Utils.stringToArrayBuffer(data)).then(function() {
      txInProgress = false;
      callback();
    }).catch(function(error) {
     console.log('BT> SEND ERROR: ' + error);
     closeSerial();
    });
  }

  // ----------------------------------------------------------

  Espruino.Core.Serial.devices.push({
    "name" : "Web Bluetooth",
    "init" : init,
    "getPorts": getPorts,
    "open": openSerial,
    "write": writeSerial,
    "close": closeSerial,
    "maxWriteLength" : NORDIC_TX_MAX_LENGTH,
  });
})();
