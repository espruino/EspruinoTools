/*
Gordon Williams (gw@pur3.co.uk)
*/
(function() {
  if (typeof require === 'undefined') return;
  var serialport = require('serialport');

  var slowWrite = true;
  var connection = undefined;
  var readListener = undefined;

  function init() {
  }  
  
  var startListening=function(callback) {
    var oldListener = readListener;
    readListener = callback;
    return oldListener;
  };

  var getPorts=function(callback) {
    serialport.list(function(err, ports) {
      callback(ports.map(function(port) {
        // port.pnpId could be handy
        return port.comName;
      }));
    });
  };
  
  var openSerial=function(serialPort, openCallback, disconnectCallback) {
    // https://github.com/voodootikigod/node-serialport#reference-guide
    connection = new serialport.SerialPort(serialPort, { /* baudRate? */});
    connection.on('open', function() {
      openCallback();
    });
    connection.on('data', function(data) {
      if (readListener !== undefined) {
        var a = new Uint8Array(data.length);
        for (var i=0;i<data.length;i++) 
          a[i] = data[i];
        readListener(a.buffer);
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
   
  var isConnected = function() {
    return connection !== undefined;
  };

  var writeSerial = function(data, showStatus) {
    // convert to an array - if we put a string into
    // a Buffer (expected by nodeserial) then I think
    // it gets interpreted as UTF8
    var a = new Buffer(data.length);
    for (var i=0;i<data.length;i++)
      a[i] = data.charCodeAt(i);
    connection.write(a);
  };
  
  // ----------------------------------------------------------
  Espruino.Core.Serial = {
    "init" : init,
    "getPorts": getPorts,
    "open": openSerial,
    "isConnected": isConnected,
    "startListening": startListening,
    "write": writeSerial,
    "close": closeSerial,
	"isSlowWrite": function() { return slowWrite; },
	"setSlowWrite": function(isOn, force) { 
        if ((!force) && Espruino.Config.SERIAL_THROTTLE_SEND) {
          console.log("ForceThrottle option is set - set Slow Write = true");
          isOn = true;
        } else
  	    console.log("Set Slow Write = "+isOn);
	  slowWrite = isOn; 
	},
  };
})();
