/*
Gordon Williams (gw@pur3.co.uk)
*/
(function() {
  if (typeof require === 'undefined') return;
  var serialport = require('serialport');

  var connection = undefined;

  var getPorts=function(callback) {
    serialport.list(function(err, ports) {
      callback(ports.map(function(port) {
        // port.pnpId could be handy
        return port.comName;
      }));
    });
  };
  
  var openSerial=function(serialPort, openCallback, receiveCallback, disconnectCallback) {
    // https://github.com/voodootikigod/node-serialport#reference-guide
    connection = new serialport.SerialPort(serialPort, { /* baudRate? */});
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
    connection.close();
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
