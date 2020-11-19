(function () {

  /* On Linux, BLE normally needs admin right to be able to access BLE
  *
  * sudo apt-get install libcap2-bin
  * sudo setcap cap_net_raw+eip $(eval readlink -f `which node`)
  */

  if (typeof require === 'undefined') return;
  var noble = undefined;

  var NORDIC_SERVICE = "6e400001b5a3f393e0a9e50e24dcca9e";
  var NORDIC_TX = "6e400002b5a3f393e0a9e50e24dcca9e";
  var NORDIC_RX = "6e400003b5a3f393e0a9e50e24dcca9e";
  var NORDIC_TX_MAX_LENGTH = 20;

  var initialised = false;
  var errored = false;

  function findByUUID(list, uuid) {
    for (var i=0;i<list.length;i++)
      if (list[i].uuid==uuid) return list[i];
    return undefined;
  }

  // map of bluetooth devices found by getPorts
  var btDevices = {};
  var newDevices = [];
  var lastDevices = [];

  var btDevice;
  var txCharacteristic;
  var rxCharacteristic;
  var txInProgress = false;
  var scanStopTimeout = undefined;


  function init() {
    Espruino.Core.Config.add("BLUETOOTH_LOW_ENERGY", {
      section: "Communications",
      name: "Connect over Bluetooth Smart (BTLE) via 'noble'",
      descriptionHTML: 'Allow connection to Espruino via BLE with the Nordic UART implementation',
      type: "boolean",
      defaultValue: true
    });
  }

  /* Needed because Noble just throws a global exception if
  it tries to start and no device is there! */
  function nobleExceptionHandler(err) {
    if (err.toString().includes("ENODEV")) {
      process.removeListener('uncaughtException', nobleExceptionHandler);
      console.log("Noble: "+err.toString()+" - disabling.");
      errored = true;
    } else throw err;
  }

  function startNoble() {
    try {
      process.on('uncaughtException', nobleExceptionHandler);
      try {
        noble = require('noble');
      } catch (e) {
        noble = require('@abandonware/noble');
      }
    } catch (e) {
      console.log("Noble: module couldn't be loaded, no node.js Bluetooth Low Energy\n", e);
      // super nasty workaround for https://github.com/sandeepmistry/noble/issues/502
      process.removeAllListeners('exit');
      errored = true;
      return false;
    }

    noble.on('stateChange', function(state) {
      process.removeListener('uncaughtException', nobleExceptionHandler);
      console.log("Noble: stateChange -> "+state);
      if (state=="poweredOn") {
        if (Espruino.Config.WEB_BLUETOOTH) {
          // Everything has already initialised, so we must disable
          // web bluetooth this way instead
          console.log("Noble: Disable Web Bluetooth as we have Noble instead");
          Espruino.Config.WEB_BLUETOOTH = false;
        }
        initialised = true;
        startScan();
      }
      if (state=="poweredOff") {
        initialised = false;
      }
    });

    noble.on('discover', function(dev) {
      if (!scanStopTimeout) {
        // we should already have stopped!
        noble.stopScanning();
        return;
      }
      if (!dev.advertisement) return;
      for (var i in newDevices)
        if (newDevices[i].path == dev.address) return; // already seen it
      var name = dev.advertisement.localName || dev.address;
      var hasUartService = dev.advertisement.serviceUuids &&
                           dev.advertisement.serviceUuids.indexOf(NORDIC_SERVICE)>=0;
      if (hasUartService ||
          Espruino.Core.Utils.isRecognisedBluetoothDevice(name)) {
        console.log("Noble: Found UART device:", name, dev.address);
        newDevices.push({ path: dev.address, description: name, type: "bluetooth", rssi: dev.rssi });
        btDevices[dev.address] = dev;
      } else console.log("Noble: Found device:", name, dev.address);
    });

    // if we didn't initialise for whatever reason, keep going anyway
    setTimeout(function() {
      if (initialised) return;
      console.log("Noble: Didn't initialise in 10 seconds, disabling.");
      errored = true;
    }, 10000);
    return true;
  }

  function startScan() {
    if (scanStopTimeout) {
      clearTimeout(scanStopTimeout);
      scanStopTimeout = undefined;
    } else {
      console.log("Noble: Starting scan");
      lastDevices = [];
      newDevices = [];
      noble.startScanning([], true);
    }
    scanStopTimeout = setTimeout(function () {
      scanStopTimeout = undefined;
      console.log("Noble: Stopping scan");
      noble.stopScanning();
    }, 3000);
  }

  var getPorts = function (callback) {
    if (errored || !Espruino.Config.BLUETOOTH_LOW_ENERGY) {
      console.log("Noble: getPorts - disabled");
      callback([], true/*instantPorts*/);
    } else if (!initialised) {
      console.log("Noble: getPorts - initialising...");
      if (!noble)
        if (!startNoble())
          return callback([], true/*instantPorts*/);
      callback(reportedDevices, false/*instantPorts*/);
    } else { // all ok - let's go!
      // Ensure we're scanning
      startScan();
      // report back device list from both the last scan and this one...
      var reportedDevices = [];
      newDevices.forEach(function (d) {
        reportedDevices.push(d);
      });
      lastDevices.forEach(function (d) {
        var found = false;
        reportedDevices.forEach(function (dv) {
          if (dv.path == d.path) found = true;
        });
        if (!found) reportedDevices.push(d);
      });
      reportedDevices.sort(function (a, b) { return a.path.localeCompare(b.path); });
      lastDevices = newDevices;
      newDevices = [];
      //console.log("Noble: reportedDevices",reportedDevices);
      callback(reportedDevices, false/*instantPorts*/);
    }
  };

  var openSerial = function (serialPort, openCallback, receiveCallback, disconnectCallback) {
    btDevice = btDevices[serialPort];
    if (btDevice === undefined) throw "BT device not found"

    if (scanStopTimeout) {
      clearTimeout(scanStopTimeout);
      scanStopTimeout = undefined;
      console.log("Noble: Stopping scan (openSerial)");
      noble.stopScanning();
    }

    txInProgress = false;

    console.log("BT> Connecting");
    btDevice.on('disconnect', function() {
      txCharacteristic = undefined;
      rxCharacteristic = undefined;
      btDevice = undefined;
      txInProgress = false;
      disconnectCallback();
    });

    btDevice.connect(function (error) {
      if (error) {
        console.log("BT> ERROR Connecting");
        btDevice = undefined;
        return openCallback();
      }
      console.log("BT> Connected");

      btDevice.discoverAllServicesAndCharacteristics(function(error, services, characteristics) {
        var btUARTService = findByUUID(services, NORDIC_SERVICE);
        txCharacteristic = findByUUID(characteristics, NORDIC_TX);
        rxCharacteristic = findByUUID(characteristics, NORDIC_RX);
        if (error || !btUARTService || !txCharacteristic || !rxCharacteristic) {
          console.log("BT> ERROR getting services/characteristics");
          console.log("Service "+btUARTService);
          console.log("TX "+txCharacteristic);
          console.log("RX "+rxCharacteristic);
          btDevice.disconnect();
          txCharacteristic = undefined;
          rxCharacteristic = undefined;
          btDevice = undefined;
          return openCallback();
        }

        rxCharacteristic.on('data', function (data) {
          receiveCallback(new Uint8Array(data).buffer);
        });
        rxCharacteristic.subscribe(function() {
          openCallback({});
        });
      });
    });
  };

  var closeSerial = function () {
    if (btDevice) {
      btDevice.disconnect(); // should call disconnect callback?
    }
  };

  // Throttled serial write
  var writeSerial = function (data, callback) {
    if (txCharacteristic === undefined) return;

    if (data.length>NORDIC_TX_MAX_LENGTH) {
      console.error("BT> TX length >"+NORDIC_TX_MAX_LENGTH);
      return callback();
    }
    if (txInProgress) {
      console.error("BT> already sending!");
      return callback();
    }

    console.log("BT> send "+JSON.stringify(data));
    txInProgress = true;
    try {
      txCharacteristic.write(Espruino.Core.Utils.stringToBuffer(data), false, function() {
        txInProgress = false;
        return callback();
      });
    } catch (e) {
      console.log("BT> SEND ERROR " + e);
      closeSerial();
    }
  };

  // ----------------------------------------------------------

  Espruino.Core.Serial.devices.push({
    "name" : "Noble Bluetooth LE",
    "init": init,
    "getPorts": getPorts,
    "open": openSerial,
    "write": writeSerial,
    "close": closeSerial,
    "maxWriteLength" : NORDIC_TX_MAX_LENGTH,
  });
})();
