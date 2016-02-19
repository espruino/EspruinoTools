/*
Gordon Williams (gw@pur3.co.uk)
*/
(function() {
  if (typeof require === 'undefined') return;
  var serialport = require('serialport');

  var connection = undefined;

  var getPorts=function(callback) {
    serialport.list(function(err, ports) {
      if (ports===undefined) callback([]);
      else callback(ports
          /**
           * Filter the available serial ports to find the one(s)
           * most likely to be an espruino (genuine, or at least STM32Fxxx based
           *
           * According to http://www.linux-usb.org/usb.ids
           * vendorId === '0x0483' -> STMicroelectronics
           * productId === '0x5740' -> STM32F407
           *
           * What is below works great for both Espruino boards, but fails for:
           *   * USB-TTL adaptors
           *   * Bluetooth Serial
           *   * BBC micro:bit, Nordic devkits, etc
           *
           * So can't be left in. TODO: return an object for each USB serial device
           * and have a `preferred : bool` field in it. Then if many devices are found
           * but only one is preferred, use that.
           */
//          .filter(function(e) {
//            return (e.vendorId === '0x0483' && e.productId === '0x5740');
//          })  
          .map(function(port) {
            // port.pnpId could be handy
            var vid = parseInt(port.vendorId);
            var pid = parseInt(port.productId);
            var d = { path : port.comName };
            if (vid||pid) d.usb = [vid,pid];
            if (port.manufacturer) d.description = port.manufacturer;
            return d;
          })
      );
    });
  };
  
  var openSerial=function(serialPort, openCallback, receiveCallback, disconnectCallback) {
    // https://github.com/voodootikigod/node-serialport#reference-guide
    connection = new serialport.SerialPort(serialPort, {
        baudrate: parseInt(Espruino.Config.BAUD_RATE)
    });
    connection.on('open', function() {
      openCallback("Ok");
    });
    connection.on('data', function(data) {
      if (receiveCallback !== undefined) {
        var a = new Uint8Array(data.length);
        for (var i=0;i<data.length;i++) 
          a[i] = data[i];
        receiveCallback(a.buffer);
      }
    });
    connection.on('close', function() {
      disconnectCallback();
      connection = undefined;
    });
  };

  var closeSerial=function(callback) {
    connection.close(callback);
  };
   
  var writeSerial = function(data, callback) {
    // convert to an array - if we put a string into
    // a Buffer (expected by nodeserial) then I think
    // it gets interpreted as UTF8
    var a = new Buffer(data.length);
    for (var i=0;i<data.length;i++)
      a[i] = data.charCodeAt(i);
    connection.write(a, callback);
  };
  
  // ----------------------------------------------------------
  Espruino.Core.Serial.devices.push({
    "getPorts": getPorts,
    "open": openSerial,
    "write": writeSerial,
    "close": closeSerial,
  });
})();
