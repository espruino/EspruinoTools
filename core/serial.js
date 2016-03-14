(function() {

  // List of ports and the devices they map to
  var portToDevice = undefined;
  var currentDevice = undefined;

  // called when data received
  var readListener = undefined;

  // are we sending binary data? If so, don't automatically insert breaks for stuff like Ctrl-C
  var sendingBinary = false;
  // For throttled write
  var slowWrite = true;
  var writeData = "";
  var writeTimeout = undefined;


  function init() {
    Espruino.Core.Config.add("BAUD_RATE", {
      section : "Communications",
      name : "Baud Rate",
      description : "When connecting over serial, this is the baud rate that is used. 9600 is the default for Espruino",
      type : {9600:9600,14400:14400,19200:19200,28800:28800,38400:38400,57600:57600,115200:115200},
      defaultValue : 9600,
    });

    var devices = Espruino.Core.Serial.devices;
    for (var i=0;i<devices.length;i++)
      if (devices[i].init)
        devices[i].init();
  }

  var startListening=function(callback) {
    var oldListener = readListener;
    readListener = callback;
    return oldListener;
  };

  var getPorts=function(callback) {
    var ports = [];
    var newPortToDevice = [];
    // get all devices
    var responses = 0;
    var devices = Espruino.Core.Serial.devices;
    if (!devices || devices.length==0) {
         portToDevice = newPortToDevice;
      return callback(ports);
    }
    devices.forEach(function (device) {
      device.getPorts(function(devicePorts) {
        if (devicePorts) {
          devicePorts.forEach(function(port) {
            if (port.usb && port.usb[0]==0x0483 && port.usb[1]==0x5740)
              port.description = "Espruino board";
            ports.push(port);
            newPortToDevice[port.path] = device;
          });
        }
        responses++;
        if (responses == devices.length) {
          portToDevice = newPortToDevice;
          callback(ports);
        }
      });
    });
  };

  var openSerial=function(serialPort, connectCallback, disconnectCallback) {
    /* If openSerial is called, we need to have called getPorts first
      in order to figure out which one of the serial_ implementations
      we must call into. */
    if (portToDevice === undefined) {
      portToDevice = []; // stop recursive calls if something errors
      return getPorts(function() {
        openSerial(serialPort, connectCallback, disconnectCallback);
      });
    }

    if (!(serialPort in portToDevice)) {
      console.error("Port "+JSON.stringify(serialPort)+" not found");
      return connectCallback(undefined);
    }
    currentDevice = portToDevice[serialPort];
    currentDevice.open(serialPort, function(cInfo) {
      // CONNECT
      if (!cInfo) {
//        Espruino.Core.Notifications.error("Unable to connect");
        console.error("Unable to open device (connectionInfo="+cInfo+")");
        connectCallback(undefined);
      } else {
        connectionInfo = cInfo;
        connectedPort = serialPort;
        console.log("Connected", cInfo);
        Espruino.callProcessor("connected", undefined, function() {
          connectCallback(cInfo);
        });
      }
    }, function(data) {
      // RECEIEVE DATA
      if (!(data instanceof ArrayBuffer)) console.warn("Serial port implementation is not returning ArrayBuffers");
      if (readListener) readListener(data);
    }, function() {
      // DISCONNECT
      currentDevice = undefined;
      if (writeTimeout!==undefined)
        clearTimeout(writeTimeout);
      writeTimeout = undefined;
      writeData = "";
      sendingBinary = false;

      Espruino.callProcessor("disconnected", undefined, function() {
        disconnectCallback();
      });
    });
  };

  var str2ab=function(str) {
    var buf=new ArrayBuffer(str.length);
    var bufView=new Uint8Array(buf);
    for (var i=0; i<str.length; i++) {
      var ch = str.charCodeAt(i);
      if (ch>=256) {
        console.warn("Attempted to send non-8 bit character - code "+ch);
        ch = "?".charCodeAt(0);
      }
      bufView[i] = ch;
    }
    return buf;
  };

  var closeSerial=function() {
    if (currentDevice)
      currentDevice.close();
    else
      console.error("Close called, but serial port not open");
  };

  var isConnected = function() {
    return currentDevice!==undefined;
  };

   // Throttled serial write
  var writeSerial = function(data, showStatus, callback) {
    if (showStatus===undefined) showStatus=true;

    // Queue our data to write
    if (writeData === "") {
      writeData = data;
    } else {
      console.error("Already sending data - calling callback immediately!");
      writeData += data;
      return callback();
    }

    /* if we're throttling our writes we want to send small
     * blocks of data at once. We still limit the size of
     * sent blocks to 512 because on Mac we seem to lose
     * data otherwise (not on any other platforms!) */
    var blockSize = slowWrite ? 15 : 512;

    showStatus &= writeData.length>blockSize;
    if (showStatus) {
      Espruino.Core.Status.setStatus("Sending...", writeData.length);
      console.log("---> "+JSON.stringify(data));
    }

    function sender() {
      writeTimeout = undefined; // we've been called

      if (writeData === "") {
        if (showStatus)
          Espruino.Core.Status.setStatus("Sent");
        if (callback)
          callback();
        return;
      }

      // Initially, split based on block size
      var d = undefined;
      var split = { start:blockSize, end:blockSize, delay:50 };
      // if we get something like Ctrl-C or `reset`, wait a bit for it to complete
      if (!sendingBinary) {
        function findSplitIdx(prev, substr, delay) {
          var match = writeData.match(substr);
          // not found
          if (match===null) return prev;
          // or previous find was earlier in str
          var end = match.index + match[0].length;
          if (end > prev.end) return prev;
          // found, and earlier
          prev.start = match.index;
          prev.end = end;
          prev.delay = delay;
          prev.match = match[0];
          return prev;
        }
        split = findSplitIdx(split, /\x03/, 250); // Ctrl-C
        split = findSplitIdx(split, /reset\(\);\n/, 250); // Reset
        split = findSplitIdx(split, /Modules.addCached\("[^\n]*"\);\n/, 250); // Adding a module
        if (split.match) console.log("Splitting at "+JSON.stringify(split.match)+", delay "+split.delay);
      }
      // Only send some of the data
      if (writeData.length>split.end) {
        d = writeData.substr(0,split.end);
        writeData = writeData.substr(split.end);
      } else {
        d = writeData;
        writeData = "";
      }
      // update status
      if (showStatus)
        Espruino.Core.Status.incrementProgress(d.length);
      // actually write data
      console.log("Sending block "+JSON.stringify(d)+", wait "+split.delay+"ms");
      currentDevice.write(d, function() {
        // Once written, start timeout
        writeTimeout = setTimeout(function() {
          console.log("Sent");
          sender();
        }, split.delay);
      });
    }

    sender(); // start sending instantly
  };


  // ----------------------------------------------------------
  Espruino.Core.Serial = {
    "devices" : [], // List of devices that can provide a serial API
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
    "setBinary": function(isOn) {
      sendingBinary = isOn;
    }
  };
})();
