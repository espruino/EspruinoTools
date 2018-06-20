(function () {
  if (typeof require === 'undefined') return;
  var isWindows = /^win/.test(process.platform);
  if (!isWindows) {
    console.log("Not on Windows, Winnus not needed");
    return;
  }
  var winnus = undefined;
  try {
    winnus = require('winnus');
  } catch (e) {
    console.log("'winnus' module not found, no Windows Bluetooth Low Energy", e);
    return;
  }
  console.log("Disable Web Bluetooth as we have Winnus instead");
  Espruino.Core.Serial.NO_WEB_BLUETOOTH = true;

  var txDataQueue = undefined;
  var txInProgress = false;
  var onDisconnect;

  function init() {

  }

  var getPorts = function (callback) {
    var devices = [];
    try {
      winnus.getDevices().forEach(function(dev) {
        devices.push({ description : dev.name, path: dev.address, type : "bluetooth" });
      });
    } catch (e) {
      console.log(e);
    }
    callback(devices, false/*instantPorts*/);
  };

  var openSerial = function (serialPort, openCallback, receiveCallback, disconnectCallback) {
    var devices = winnus.getDevices();
    var foundDevice;
    devices.forEach(function(device) {
      if (device.address == serialPort)
        foundDevice = device;
    });
    if (foundDevice === undefined) throw "BT device not found"

    txDataQueue = undefined;
    txInProgress = false;
    onDisconnect = disconnectCallback;

    try {
      winnus.connect(foundDevice, function(rxData) {
        receiveCallback(Espruino.Core.Utils.stringToArrayBuffer(rxData));
      });
      openCallback({}); // success!
    } catch (e) {
      openCallback(); // fail.
    }
  };

  var closeSerial = function () {
    txDataQueue = undefined;
    txInProgress = false;
    try {
      winnus.disconnect();
    } catch (e) {
      console.log("WINNUS ERROR:"+e.toString());
    }
    if (onDisconnect) {
      onDisconnect();
      onDisconnect = undefined;
    }
  };

  // Throttled serial write
  var writeSerial = function (data, callback) {
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
      var CHUNKSIZE = 20;
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
        winnus.write(chunk);
        setTimeout(function() {
          txInProgress = false;
          if (txDataQueue)
            writeChunk();
        }, 20);
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
    "name" : "Windows Bluetooth LE",
    "init": init,
    "getPorts": getPorts,
    "open": openSerial,
    "write": writeSerial,
    "close": closeSerial,
  });
})();
