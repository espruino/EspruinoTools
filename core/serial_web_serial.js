(function() {

  function getStatus(ignoreSettings) {
    if (typeof navigator == "undefined") {
      return {warning:"Not running in a browser"};
    }
    if (!navigator.serial) {
      if (Espruino.Core.Utils.isChrome())
        return {error:`Chrome currently requires <code>chrome://flags/#enable-experimental-web-platform-features</code> to be enabled.`};
      else if (Espruino.Core.Utils.isFirefox())
        return {error:`Firefox doesn't support Web Serial - try using Chrome`};
      else
        return {error:"No navigator.serial. Do you have a supported browser?"};
    }
    if (window && window.location && window.location.protocol=="http:" &&
        window.location.hostname!="localhost") {
      return {error:"Serving off HTTP (not HTTPS)"};
    }
    if (!ignoreSettings && !Espruino.Config.WEB_SERIAL)
      return {warning:`"Web Serial" disabled in settings`};
    return true;
  }

  var OK = true;
  var testedCompatibility = false;

  var serialPort;
  var serialPortReader;
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
      if (getStatus(true)!==true)
        OK = false;
    }
    if (Espruino.Config.WEB_SERIAL && OK)
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
        serialPortReader = serialPort.readable.getReader();
        serialPortReader.read().then(function ({ value, done }) {
          serialPortReader.releaseLock();
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
      serialPortReader.cancel().then(function() {
        serialPort.close();
        serialPort = undefined;
        serialPortReader = undefined;
      });
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
    "getStatus": getStatus,
    "getPorts": getPorts,
    "open": openSerial,
    "write": writeSerial,
    "close": closeSerial,
  });
})();
