/*
Gordon Williams (gw@pur3.co.uk)

Common entrypoint for all communications from the IDE. This handles
all serial_*.js connection types and passes calls to the correct one.

To add a new serial device, you must add an object to
  Espruino.Core.Serial.devices:

  Espruino.Core.Serial.devices.push({
    "name" : "Test",               // Name, when initialising
    "init" : function()            // Gets called at startup
    "getStatus" : function(ignoreSettings)   // Optional - returns:
      // true - all ok
      // {error: error_string}
      // {warning: warning_string}
    "getPorts": function(callback) // calls 'callback' with an array of ports:
        callback([{path:"TEST",          // path passed to 'open' (and displayed to user)
                   description:"test",   // description displayed to user
                   type:"test",           // bluetooth|usb|socket - used to show icon in UI
                   // autoconnect : true  // automatically conect to this (without the connect menu)
                   // promptsUser : true  // this is set if we expect the Web Browser to prompt the user for this item
                 }], true); // instantPorts - will getPorts return all the ports on the first call, or does it need multiple calls (eg. Bluetooth)
    "open": function(path, openCallback, receiveCallback, disconnectCallback),
    "write": function(dataAsString, callbackWhenWritten)
    "close": function(),
    "maxWriteLength": 20, // optional - the maximum amount of characters that should be given to 'write' at a time
  });

*/
(function() {
  // If XOFF flow control is received, this is how long we wait
  // before resuming anyway
  const FLOW_CONTROL_RESUME_TIMEOUT = 20000; // 20 sec

  // List of ports and the devices they map to
  var portToDevice = undefined;
  // The current connected device (from Espruino.Core.Serial.devices)
  var currentDevice = undefined;

  // called when data received
  var readListener = undefined;

  // are we sending binary data? If so, don't automatically insert breaks for stuff like Ctrl-C
  var sendingBinary = false;
  // For throttled write
  var slowWrite = true;
  var writeData = [];
  var writeTimeout = undefined;
  /// flow control XOFF received - we shouldn't send anything
  var flowControlXOFF = false;
  /// Set up when flow control received - if no response is received we start sending anyway
  var flowControlTimeout;


  function init() {
    Espruino.Core.Config.add("BAUD_RATE", {
      section : "Communications",
      name : "Baud Rate",
      description : "When connecting over serial, this is the baud rate that is used. 9600 is the default for Espruino",
      type : {9600:9600,14400:14400,19200:19200,28800:28800,38400:38400,57600:57600,115200:115200},
      defaultValue : 9600,
    });
    Espruino.Core.Config.add("SERIAL_IGNORE", {
     section : "Communications",
     name : "Ignore Serial Ports",
     description : "A '|' separated list of serial port paths to ignore, eg `/dev/ttyS*|/dev/*.SOC`",
     type : "string",
     defaultValue : "/dev/ttyS*|/dev/*.SOC|/dev/*.MALS"
   });
    Espruino.Core.Config.add("SERIAL_FLOW_CONTROL", {
     section : "Communications",
     name : "Software Flow Control",
     description : "Respond to XON/XOFF flow control characters to throttle data uploads. By default Espruino sends XON/XOFF for USB and Bluetooth (on 2v05+).",
     type : "boolean",
     defaultValue : true
   });

    var devices = Espruino.Core.Serial.devices;
    for (var i=0;i<devices.length;i++) {
      console.log("  - Initialising Serial "+devices[i].name);
      if (devices[i].init)
        devices[i].init();
    }
  }

  var startListening=function(callback) {
    var oldListener = readListener;
    readListener = callback;
    return oldListener;
  };

  /* Calls 'callback(port_list, shouldCallAgain)'
   'shouldCallAgain==true' means that more devices
   may appear later on (eg Bluetooth LE).*/
  var getPorts=function(callback) {
    var ports = [];
    var newPortToDevice = [];
    // get all devices
    var responses = 0;
    var devices = Espruino.Core.Serial.devices;
    if (!devices || devices.length==0) {
         portToDevice = newPortToDevice;
      return callback(ports, false);
    }
    var shouldCallAgain = false;
    devices.forEach(function (device) {
      //console.log("getPorts -->",device.name);
      device.getPorts(function(devicePorts, instantPorts) {
        //console.log("getPorts <--",device.name);
        if (instantPorts===false) shouldCallAgain = true;
        if (devicePorts) {
          devicePorts.forEach(function(port) {
            var ignored = false;
            if (Espruino.Config.SERIAL_IGNORE)
              Espruino.Config.SERIAL_IGNORE.split("|").forEach(function(wildcard) {
                var regexp = "^"+wildcard.replace(/\./g,"\\.").replace(/\*/g,".*")+"$";
                if (port.path.match(new RegExp(regexp)))
                  ignored = true;
              });

            if (!ignored) {
              if (port.usb && port.usb[0]==0x0483 && port.usb[1]==0x5740)
                port.description = "Espruino board";
              ports.push(port);
              newPortToDevice[port.path] = device;
            }
          });
        }
        responses++;
        if (responses == devices.length) {
          portToDevice = newPortToDevice;
          ports.sort(function(a,b) {
            if (a.unimportant && !b.unimportant) return 1;
            if (b.unimportant && !a.unimportant) return -1;
            return 0;
          });
          callback(ports, shouldCallAgain);
        }
      });
    });
  };

  var openSerial=function(serialPort, connectCallback, disconnectCallback) {
    return openSerialInternal(serialPort, connectCallback, disconnectCallback, 5);
  }

  var openSerialInternal=function(serialPort, connectCallback, disconnectCallback, attempts) {
    /* If openSerial is called, we need to have called getPorts first
      in order to figure out which one of the serial_ implementations
      we must call into. */
    if (portToDevice === undefined) {
      portToDevice = []; // stop recursive calls if something errors
      return getPorts(function() {
        openSerialInternal(serialPort, connectCallback, disconnectCallback, attempts);
      });
    }

    if (!(serialPort in portToDevice)) {
      if (serialPort.toLowerCase() in portToDevice) {
        serialPort = serialPort.toLowerCase();
      } else {
        if (attempts>0) {
          console.log("Port "+JSON.stringify(serialPort)+" not found - checking ports again ("+attempts+" attempts left)");
          setTimeout(function() {
            getPorts(function() {
              openSerialInternal(serialPort, connectCallback, disconnectCallback, attempts-1);
            });
          }, 500);
          return;
        } else {
          console.error("Port "+JSON.stringify(serialPort)+" not found");
          return connectCallback(undefined);
        }
      }
    }

    var portInfo = { port:serialPort };
    connectionInfo = undefined;
    flowControlXOFF = false;
    if (flowControlTimeout) {
      clearTimeout(flowControlTimeout);
      flowControlTimeout = undefined;
    }
    currentDevice = portToDevice[serialPort];
    currentDevice.open(serialPort, function(cInfo) {  // CONNECT
      if (!cInfo) {
//        Espruino.Core.Notifications.error("Unable to connect");
        console.error("Unable to open device (connectionInfo="+cInfo+")");
        connectCallback(undefined);
        connectCallback = undefined;
      } else {
        connectionInfo = cInfo;
        connectedPort = serialPort;
        console.log("Connected", cInfo);
        if (connectionInfo.portName)
          portInfo.portName = connectionInfo.portName;
        Espruino.callProcessor("connected", portInfo, function() {
          connectCallback(cInfo);
          connectCallback = undefined;
        });
      }
    }, function(data) { // RECEIEVE DATA
      if (!(data instanceof ArrayBuffer)) console.warn("Serial port implementation is not returning ArrayBuffers");
      if (Espruino.Config.SERIAL_FLOW_CONTROL) {
        var u = new Uint8Array(data);
        for (var i=0;i<u.length;i++) {
          if (u[i]==17) { // XON
            console.log("XON received => resume upload");
            flowControlXOFF = false;
            if (flowControlTimeout) {
              clearTimeout(flowControlTimeout);
              flowControlTimeout = undefined;
            }
          }
          if (u[i]==19) { // XOFF
            console.log("XOFF received => pause upload");
            flowControlXOFF = true;
            if (flowControlTimeout)
              clearTimeout(flowControlTimeout);
            flowControlTimeout = setTimeout(function() {
              console.log("XOFF timeout => resume upload anyway");
              flowControlXOFF = false;
              flowControlTimeout = undefined;
            }, FLOW_CONTROL_RESUME_TIMEOUT);
          }
        }
      }
      if (readListener) readListener(data);
    }, function(error) { // DISCONNECT
      currentDevice = undefined;
      if (writeTimeout!==undefined)
        clearTimeout(writeTimeout);
      writeTimeout = undefined;
      writeData = [];
      sendingBinary = false;
      flowControlXOFF = false;
      if (flowControlTimeout) {
        clearTimeout(flowControlTimeout);
        flowControlTimeout = undefined;
      }
      if (connectCallback) {
        // we got a disconnect when we hadn't connected...
        // Just call connectCallback(undefined), don't bother sending disconnect
        connectCallback(error);
        connectCallback = undefined;
        return;
      }
      connectionInfo = undefined;
      Espruino.callProcessor("disconnected", portInfo, function() {
        if (disconnectCallback) disconnectCallback(portInfo);
        disconnectCallback = undefined;
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
    if (currentDevice) {
      currentDevice.close();
      currentDevice = undefined;
    } else
      console.error("Close called, but serial port not open");
  };

  var isConnected = function() {
    return currentDevice!==undefined;
  };

  var writeSerialWorker = function(isStarting) {
    writeTimeout = undefined; // we've been called
    // check flow control
    if (flowControlXOFF) {
      /* flow control was enabled - bit hacky (we could use a callback)
      but safe - just check again in a bit to see if we should send */
      writeTimeout = setTimeout(function() {
        writeSerialWorker();
      }, 50);
      return;
    }

    // if we disconnected while sending, empty queue
    if (currentDevice === undefined) {
      if (writeData[0].callback)
        writeData[0].callback();
      writeData.shift();
      if (writeData.length) setTimeout(function() {
        writeSerialWorker(false);
      }, 1);
      return;
    }

    if (writeData[0].data === "") {
      if (writeData[0].showStatus)
        Espruino.Core.Status.setStatus("Sent");
      if (writeData[0].callback)
        writeData[0].callback();
      writeData.shift(); // remove this empty first element
      if (!writeData.length) return; // anything left to do?
      isStarting = true;
    }

    if (isStarting) {
      var blockSize = 512;
      if (currentDevice.maxWriteLength)
        blockSize = currentDevice.maxWriteLength;
      /* if we're throttling our writes we want to send small
       * blocks of data at once. We still limit the size of
       * sent blocks to 512 because on Mac we seem to lose
       * data otherwise (not on any other platforms!) */
      if (slowWrite) blockSize=19;
      writeData[0].blockSize = blockSize;

      writeData[0].showStatus &= writeData[0].data.length>writeData[0].blockSize;
      if (writeData[0].showStatus) {
        Espruino.Core.Status.setStatus("Sending...", writeData[0].data.length);
        console.log("---> "+JSON.stringify(writeData[0].data));
      }
    }

    // Initial split use previous, or don't
    var d = undefined;
    var split = writeData[0].nextSplit || { start:0, end:writeData[0].data.length, delay:0 };
    // if we get something like Ctrl-C or `reset`, wait a bit for it to complete
    if (!sendingBinary) {
      function findSplitIdx(prev, substr, delay, reason) {
        var match = writeData[0].data.match(substr);
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
        prev.reason = reason;
        return prev;
      }
      split = findSplitIdx(split, /\x03/, 250, "Ctrl-C"); // Ctrl-C
      split = findSplitIdx(split, /reset\(\);\n/, 250, "reset()"); // Reset
      split = findSplitIdx(split, /load\(\);\n/, 250, "load()"); // Load
      split = findSplitIdx(split, /Modules.addCached\("[^\n]*"\);\n/, 250, "Modules.addCached"); // Adding a module
      split = findSplitIdx(split, /\x10require\("Storage"\).write\([^\n]*\);\n/, 500, "Storage.write"); // Write chunk of data
    }
    // Otherwise split based on block size
    if (!split.match || split.end >= writeData[0].blockSize) {
      if (split.match) writeData[0].nextSplit = split;
      split = { start:0, end:writeData[0].blockSize, delay:0 };
    }
    if (split.match) console.log("Splitting for "+split.reason+", delay "+split.delay);
    // Only send some of the data
    if (writeData[0].data.length>split.end) {
      if (slowWrite && split.delay==0) split.delay=50;
      d = writeData[0].data.substr(0,split.end);
      writeData[0].data = writeData[0].data.substr(split.end);
      if (writeData[0].nextSplit) {
        writeData[0].nextSplit.start -= split.end;
        writeData[0].nextSplit.end -= split.end;
        if (writeData[0].nextSplit.end<=0)
          writeData[0].nextSplit = undefined;
      }
    } else {
      d = writeData[0].data;
      writeData[0].data = "";
      writeData[0].nextSplit = undefined;
    }
    // update status
    if (writeData[0].showStatus)
      Espruino.Core.Status.incrementProgress(d.length);
    // actually write data
    //console.log("Sending block "+JSON.stringify(d)+", wait "+split.delay+"ms");
    currentDevice.write(d, function() {
      // Once written, start timeout
      writeTimeout = setTimeout(function() {
        writeSerialWorker();
      }, split.delay);
    });
  }

   // Throttled serial write
  var writeSerial = function(data, showStatus, callback) {
    if (showStatus===undefined) showStatus=true;

    /* Queue our data to write. If there was previous data and no callback to
    invoke on this data or the previous then just append data. This would happen
    if typing in the terminal for example. */
    if (!callback && writeData.length && !writeData[writeData.length-1].callback) {
      writeData[writeData.length-1].data += data;
    } else {
      writeData.push({data:data,callback:callback,showStatus:showStatus});
      /* if this is our first data, start sending now. Otherwise we're already
      busy sending and will pull data off writeData when ready */
      if (writeData.length==1)
        writeSerialWorker(true);
    }
  };


  // ----------------------------------------------------------
  Espruino.Core.Serial = {
    "devices" : [], // List of devices that can provide a serial API
    "init" : init,
    "getPorts": getPorts,
    "open": openSerial,
    "isConnected": isConnected,
    "startListening": startListening,
    "write": writeSerial, // function(data, showStatus, callback)
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
