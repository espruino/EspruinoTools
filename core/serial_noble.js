(function () {

  /* On Linux, BLE normnally needs admin right to be able to access BLE
  *
  * sudo apt-get install libcap2-bin
  * sudo setcap cap_net_raw+eip $(eval readlink -f `which node`)
  */

  if (typeof require === 'undefined') return;
  var noble = undefined;
  try {
    noble = require('noble');
  } catch (e) {
    console.log("'noble' module couldn't be loaded, no node.js Bluetooth Low Energy", e);
    return;
  }

  var NORDIC_SERVICE = "6e400001b5a3f393e0a9e50e24dcca9e";
  var NORDIC_TX = "6e400002b5a3f393e0a9e50e24dcca9e";
  var NORDIC_RX = "6e400003b5a3f393e0a9e50e24dcca9e";

  var initialised = false;
  var scanWhenInitialised = undefined;

  function str2buf(str) {
    var buf = new Buffer(str.length);
    for (var i = 0; i < buf.length; i++) {
      buf.writeUInt8(str.charCodeAt(i), i);
    }
    return buf;
  }

  function dataview2ab(dv) {
    var bufView = new Uint8Array(dv.byteLength);
    for (var i = 0; i < bufView.length; i++) {
      bufView[i] = dv.getUint8(i);
    }
    return bufView.buffer;
  }

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
  var txDataQueue = undefined;
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


  noble.on('stateChange', function(state) {
    if (state=="poweredOn") {
      initialised = true;
      if (scanWhenInitialised) {
        getPorts(scanWhenInitialised);
        scanWhenInitialised = undefined;
      }
    }
    if (state=="poweredOff") initialised = false;
  });
  // if we didn't initialise for whatever reason, keep going anyway
  setTimeout(function() {
    if (scanWhenInitialised) {
      scanWhenInitialised([]);
      scanWhenInitialised = undefined;
    }
  }, 1000);

  noble.on('discover', function(dev) {
    if (!dev.advertisement) return;
    for (var i in newDevices)
      if (newDevices[i].path == dev.address) return; // already seen it
    var name = dev.advertisement.localName;
    var hasUartService = dev.advertisement.serviceUuids.indexOf(NORDIC_SERVICE)>=0;
    if (hasUartService ||
        (name &&
          (name.substr(0, 7) == "Puck.js" ||
           name.substr(0, 8) == "Espruino"))) {
      console.log("Found UART device:", name, dev.address);
      newDevices.push({ path: dev.address, description: name });
      btDevices[dev.address] = dev;
    } else console.log("Found device:", name, dev.address);
  });


  var getPorts = function (callback) {
    if (!Espruino.Config.BLUETOOTH_LOW_ENERGY) {
      callback([]);
    } else if (!initialised) {
      // if not initialised yet, wait until we are
      if (scanWhenInitialised) scanWhenInitialised([]);
      scanWhenInitialised = callback;
    } else { // all ok - let's go!
      if (scanStopTimeout) {
        clearTimeout(scanStopTimeout);
        scanStopTimeout = undefined;
      } else {
        console.log("noble starting scan");
        lastDevices = [];
        newDevices = [];
      }
      noble.startScanning([], true);

      setTimeout(function () {
        scanStopTimeout = setTimeout(function () {
          scanStopTimeout = undefined;
          console.log("noble stopping scan");
          noble.stopScanning();
        }, 2000);
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
        callback(reportedDevices);
      }, 1500);
    }
  };

  var openSerial = function (serialPort, openCallback, receiveCallback, disconnectCallback) {
    btDevice = btDevices[serialPort];
    if (btDevice === undefined) throw "BT device not found"

    if (scanStopTimeout) {
      clearTimeout(scanStopTimeout);
      scanStopTimeout = undefined;
      console.log("noble stopping scan");
      noble.stopScanning();
    }

    txDataQueue = undefined;
    txInProgress = false;

    console.log("BT> Connecting");
    btDevice.on('disconnect', function() {
      txCharacteristic = undefined;
      rxCharacteristic = undefined;
      btDevice = undefined;
      txDataQueue = undefined;
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
    if (typeof txDataQueue != "undefined" || txInProgress) {
      if (txDataQueue === undefined)
        txDataQueue = "";
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
        chunk = txDataQueue.substr(0, CHUNKSIZE);
        txDataQueue = txDataQueue.substr(CHUNKSIZE);
      }
      txInProgress = true;
      console.log("BT> Sending " + JSON.stringify(chunk));
      try {
        txCharacteristic.write(str2buf(chunk), false, function() {
          txInProgress = false;
          if (txDataQueue)
            writeChunk();
        });
      } catch (e) {
        console.log("BT> ERROR " + e);
        txDataQueue = undefined;
      }
    }
    writeChunk();
    return callback();
  };

  // ----------------------------------------------------------

  Espruino.Core.Serial.devices.push({
    "init": init,
    "getPorts": getPorts,
    "open": openSerial,
    "write": writeSerial,
    "close": closeSerial
  });
})();
