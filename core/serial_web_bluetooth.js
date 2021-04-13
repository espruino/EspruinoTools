(function() {

  var isSupportedByBrowser = false;
  if (typeof navigator != "undefined" &&
      navigator.bluetooth) {
    if (navigator.bluetooth.getAvailability)
      navigator.bluetooth.getAvailability().then(x=>isSupportedByBrowser=x);
    else
     isSupportedByBrowser=true;
  }

  function getStatus(ignoreSettings) {
    /* If BLE is handled some other way (eg winnus), then it
    can be disabled here */
    if (Espruino.Core.Serial.NO_WEB_BLUETOOTH) {
      OK = false;
      return {warning:`Disabled by another Serial service in Web IDE (Serial.NO_WEB_BLUETOOTH)`};
    }
    if (typeof navigator == "undefined") {
      return {warning:"Not running in a browser"};
    }
    if (!navigator.bluetooth) {
      if (Espruino.Core.Utils.isAppleDevice())
        return {error:`Safari on iOS has no Web Bluetooth support. You need <a href="https://itunes.apple.com/us/app/webble/id1193531073" target="_blank">to use the WebBLE app</a>`};
      else if (Espruino.Core.Utils.isChrome() && Espruino.Core.Utils.isLinux())
        return {error:`Chrome on Linux requires <code>chrome://flags/#enable-experimental-web-platform-features</code> to be enabled.`};
      else if (Espruino.Core.Utils.isFirefox())
        return {error:`Firefox doesn't support Web Bluetooth - try using Chrome`};
      else
        return {error:"No navigator.bluetooth. Do you have a supported browser?"};
    }
    if (navigator.bluetooth.requestDevice &&
        navigator.bluetooth.requestDevice.toString().indexOf('callExtension') >= 0) {
      status("info","Using Urish's Windows 10 Web Bluetooth Polyfill");
    } else if (navigator.platform.indexOf("Win")>=0 &&
        (navigator.userAgent.indexOf("Chrome/")>=0)) {
      var chromeVer = navigator.userAgent.match(/Chrome\/(\d+)/);
      if (chromeVer && chromeVer[1]<68) {
        return {error:"Web Bluetooth available, but Windows Web Bluetooth is broken in <68"};
      }
    }
    if (window && window.location && window.location.protocol=="http:" &&
        window.location.hostname!="localhost") {
      return {error:"Serving off HTTP (not HTTPS)"};
    }
    if (!isSupportedByBrowser) {
      return {error:"Web Bluetooth API available, but not supported by this Browser"};
    }
    if (!ignoreSettings && !Espruino.Config.WEB_BLUETOOTH)
      return {warning:`"Web Bluetooth" disabled in settings`};
    return true;
  }

  var OK = true;
  var NORDIC_SERVICE = "6e400001-b5a3-f393-e0a9-e50e24dcca9e";
  var NORDIC_TX = "6e400002-b5a3-f393-e0a9-e50e24dcca9e";
  var NORDIC_RX = "6e400003-b5a3-f393-e0a9-e50e24dcca9e";
  var NORDIC_DEFAULT_TX_LENGTH = 20; ///< default value for maxPacketLength
  var testedCompatibility = false;
  /// List of previously paired devices that we could reconnect to without the chooser
  var pairedDevices = [];

  var btServer = undefined;
  var connectionDisconnectCallback;

  var txCharacteristic;
  var rxCharacteristic;
  var maxPacketLength; ///< packet length (MTU-3) for the currently active connection
  var txInProgress = false;

  function init() {
    Espruino.Core.Config.add("WEB_BLUETOOTH", {
      section : "Communications",
      name : "Connect over Bluetooth Smart (Web Bluetooth)",
      descriptionHTML : 'Allow connection to Espruino via BLE with the Nordic UART implementation',
      type : "boolean",
      defaultValue : true,
    });
    // If we're ok and have the getDevices extension, use it to remember previously paired devices
    if (getStatus(true)===true && navigator.bluetooth.getDevices) {
      console.log("BT> bluetooth.getDevices exists - grab known devices");
      navigator.bluetooth.getDevices().then(devices=>{
        pairedDevices = devices;
      });
    }
  }

  function getPorts(callback) {
    if (!testedCompatibility) {
      testedCompatibility = true;
      /* Check compatibility here - the Web Bluetooth Polyfill for windows
      loads after everything else, so we can't check when this page is
      parsed.*/
      if (getStatus(true)!==true)
        OK = false;
    }
    if (Espruino.Config.WEB_BLUETOOTH && OK) {
      var list = [{path:'Web Bluetooth', description:'Bluetooth Low Energy', type : "bluetooth", promptsUser:true}];
      pairedDevices.forEach(function(btDevice) {
        list.push({path:btDevice.name, description:'Web Bluetooth device', type : "bluetooth"});
      });
      callback(list, true/*instantPorts*/);
    } else
      callback(undefined, true/*instantPorts*/);
  }

  function setMaxPacketLength(n) {
    maxPacketLength = n;
    SerialDevice.maxWriteLength = n;
  }

  function openSerial(serialPort, openCallback, receiveCallback, disconnectCallback) {
    connectionDisconnectCallback = disconnectCallback;

    var btDevice;
    var btService;
    var promise;
    // Check for pre-paired devices
    btDevice = pairedDevices.find(dev=>dev.name == serialPort);
    if (btDevice) {
      console.log("BT> Pre-paired Web Bluetooth device already found");
      promise = Promise.resolve(btDevice);
    } else {
      var filters = [];
      Espruino.Core.Utils.recognisedBluetoothDevices().forEach(function(namePrefix) {
        filters.push({ namePrefix: namePrefix });
      });
      filters.push({ services: [ NORDIC_SERVICE ] });
      console.log("BT> Starting device chooser");
      promise = navigator.bluetooth.requestDevice({
          filters: filters,
          optionalServices: [ NORDIC_SERVICE ]});
    }
    promise.then(function(device) {
      btDevice = device;
      Espruino.Core.Status.setStatus("Connecting to "+btDevice.name);
      console.log('BT>  Device Name:       ' + btDevice.name);
      console.log('BT>  Device ID:         ' + btDevice.id);
      // Was deprecated: Should use getPrimaryServices for this in future
      //console.log('BT>  Device UUIDs:      ' + device.uuids.join('\n' + ' '.repeat(21)));
      btDevice.addEventListener('gattserverdisconnected', function() {
        console.log("BT> Disconnected (gattserverdisconnected)");
        closeSerial();
      }, {once:true});
      return btDevice.gatt.connect();
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
      setMaxPacketLength(NORDIC_DEFAULT_TX_LENGTH); // set default packet length
      console.log("BT> RX characteristic:"+JSON.stringify(rxCharacteristic));
      rxCharacteristic.addEventListener('characteristicvaluechanged', function(event) {
        // In Chrome 50+, a DataView is returned instead of an ArrayBuffer.
        var value = event.target.value.buffer;
        if (value.byteLength > maxPacketLength) {
          console.log("BT> Received packet of length "+value.byteLength+" - assuming increased MTU");
          setMaxPacketLength(value.byteLength);
        }
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
      if (!pairedDevices.includes(btDevice))
        pairedDevices.push(btDevice);
      setTimeout(function() {
        Espruino.Core.Status.setStatus("BLE configured. Receiving data...");
        openCallback({ portName : btDevice.name });
      }, 500);
    }).catch(function(error) {
      console.log('BT> ERROR: ' + error);
      closeSerial({error:error.toString()});
    });
  }

  function closeSerial(err) {
    if (btServer) {
      btServer.disconnect();
      btServer = undefined;
      txCharacteristic = undefined;
      rxCharacteristic = undefined;
      setMaxPacketLength(NORDIC_DEFAULT_TX_LENGTH); // set default
    }
    if (connectionDisconnectCallback) {
      connectionDisconnectCallback(err);
      connectionDisconnectCallback = undefined;
    }
  }

  // Throttled serial write
  function writeSerial(data, callback) {
    if (!txCharacteristic) return;

    if (data.length>maxPacketLength) {
      console.error("BT> TX length >"+maxPacketLength);
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
  var SerialDevice = {
    "name" : "Web Bluetooth",
    "init" : init,
    "getStatus": getStatus,
    "getPorts": getPorts,
    "open": openSerial,
    "write": writeSerial,
    "close": closeSerial,
    "maxWriteLength" : maxPacketLength,
  };
  Espruino.Core.Serial.devices.push(SerialDevice);
})();
