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
      if (readListener !== undefined) 
        readListener(data.toString());
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
    connection.write(data);
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
