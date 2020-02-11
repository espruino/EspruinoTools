(function() {

  // Fix up prefixing
  if (typeof navigator == "undefined") {
    console.log("Not running in a browser - Web Serial not enabled");
    return;
  }

  function checkCompatibility() {
    if (!navigator.serial) {
      console.log("No navigator.serial - Web Serial not enabled");
      return false;
    }
    if (window && window.location && window.location.protocol=="http:" &&
        window.location.hostname!="localhost") {
      console.log("Serving off HTTP (not HTTPS) - Web Serial not enabled");
      return false;
    }
    return true;
  }

  var WEB_SERIAL_OK = true;
  var testedCompatibility = false;

  var serialPort = undefined;
  var connectionDisconnectCallback;

  function init() {
    Espruino.Core.Config.add("WEB_SERIAL", {
      section : "Communications",
      name : "Connect over Serial (Web Serial)",
      descriptionHTML : 'Allow connection to Espruino from the Web Browser via Serial. The API must currently be enabled by pasting <code>chrome://flags#enable-experimental-web-platform-features</code> into the address bar and clicking <code>Enable</code>',
      type : "boolean",
      defaultValue : true,
    });
  }

  function getPorts(callback) {
    if (!testedCompatibility) {
      testedCompatibility = true;
      if (!checkCompatibility())
        WEB_SERIAL_OK = false;
    }
    if (Espruino.Config.WEB_SERIAL && WEB_SERIAL_OK)
      callback([{path:'Web Serial', description:'Serial', type : "serial"}], true/*instantPorts*/);
    else
      callback(undefined, true/*instantPorts*/);
  }

  function openSerial(_, openCallback, receiveCallback, disconnectCallback) {
    // TODO: Pass USB vendor and product ID filter when supported by Chrome.
    // TODO: Retrieve device name when/if supported and use a pairedDevices list like in Web Bluetooth
    navigator.serial.requestPort({}).then(function(port) {
      Espruino.Core.Status.setStatus("Connecting to serial port");
      serialPort = port;
      return port.open({ baudrate: parseInt(Espruino.Config.BAUD_RATE) });
    }).then(function () {
      function readLoop() {
        var reader = serialPort.readable.getReader();
        reader.read().then(function ({ value, done }) {
          reader.releaseLock();
          if (value) {
            receiveCallback(value.buffer);
          }
          if (done) {
            disconnectCallback();
          } else {
            readLoop();
          }
        });
      }
      readLoop();
      Espruino.Core.Status.setStatus("Serial connected. Receiving data...");
      // TODO: Provide a device name when supported by Chrome.
      openCallback({});
    }).catch(function(error) {
      console.log('Serial> ERROR: ' + error);
      disconnectCallback();
    });
  }

  function closeSerial() {
    if (serialPort) {
      serialPort.close();
      serialPort = undefined;
    }
    if (connectionDisconnectCallback) {
      connectionDisconnectCallback();
      connectionDisconnectCallback = undefined;
    }
  }

  function writeSerial(data, callback) {
    var writer = serialPort.writable.getWriter();
    writer.write(Espruino.Core.Utils.stringToArrayBuffer(data)).then(function() {
      callback();
    }).catch(function(error) {
      console.log('Serial> SEND ERROR: ' + error);
      closeSerial();
    });
    writer.releaseLock();
  }

  // ----------------------------------------------------------

  Espruino.Core.Serial.devices.push({
    "name" : "Web Serial",
    "init" : init,
    "getPorts": getPorts,
    "open": openSerial,
    "write": writeSerial,
    "close": closeSerial,
  });
})();
