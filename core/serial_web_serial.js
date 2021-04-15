(function() {

  // TODO: Pass USB vendor and product ID filter when supported by Chrome.
  //       - maybe not? We might want to connect to a non-official Espruino board
  // TODO: Use device name when/if supported

  function getStatus(ignoreSettings) {
    if (typeof navigator == "undefined") {
      return {warning:"Not running in a browser"};
    }
    if (getPortsErrorMessage!==undefined) {
      return {error:getPortsErrorMessage};
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
  var getPortsErrorMessage = undefined;
  var testedCompatibility = false;
  /// List of previously paired devices that we could reconnect to without the chooser
  var pairedDevices = [];

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
    // If we're ok and have the getDevices extension, use it to remember previously paired devices
    if (getStatus(true)===true && navigator.serial.getPorts) {
      console.log("Serial> serial.getPorts exists - grab known devices");
      navigator.serial.getPorts().then(devices=>{
        pairedDevices = devices;
      }, err=>{
        getPortsErrorMessage = err.toString();
        console.log("Serial> "+err.toString());
      });
    }
  }

  function getSerialDeviceInfo(device) {
    var idx = pairedDevices.indexOf(device);
    var deviceInfo = { path : "webserial:"+(idx>=0?idx:""), type : "usb", description : "Previously connected device"};
    if (device.getInfo) {
      var info = device.getInfo();
      if (info.usbVendorId && info.usbProductId) {
        deviceInfo.path = "webserial:"+(63356+info.usbVendorId).toString(16).substr(-4)+":"+(63356+info.usbProductId).toString(16).substr(-4);
      }
    }
    return deviceInfo;
  }

  function getPorts(callback) {
    if (!testedCompatibility) {
      testedCompatibility = true;
      if (getStatus(true)!==true)
        OK = false;
    }
    if (Espruino.Config.WEB_SERIAL && OK) {
      var list = [{path:'Web Serial', description:'Serial', type : "serial", promptsUser:true}];
      pairedDevices.forEach(function(dev) {
        list.push(getSerialDeviceInfo(dev));
      });
      callback(list, true/*instantPorts*/);
    } else
      callback(undefined, true/*instantPorts*/);
  }

  function openSerial(path, openCallback, receiveCallback, disconnectCallback) {
    var promise;
    // Check for pre-paired devices
    serialPort = pairedDevices.find(dev=>getSerialDeviceInfo(dev).path == path);
    if (serialPort) {
      console.log("Serial> Pre-paired Web Serial device already found");
      promise = Promise.resolve(serialPort);
    } else {
      console.log("Serial> Starting device chooser");
      promise = navigator.serial.requestPort({});
    }
    promise.then(function(port) {
      Espruino.Core.Status.setStatus("Connecting to serial port");
      serialPort = port;
      var br = parseInt(Espruino.Config.BAUD_RATE);
      return port.open({ baudrate: br/*old*/, baudRate: br/*new*/ });
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
      if (!pairedDevices.includes(serialPort))
        pairedDevices.push(serialPort);

      openCallback({ portName : getSerialDeviceInfo(serialPort).path });
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
