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

  // filler to allow us to use EspruinoWebTools' Connection class
  var uart = { writeProgress : () => {} };
  function log(level, str) { if (level<3) console.log("serial:", str); }
  function ab2str(buf) { return String.fromCharCode.apply(null, new Uint8Array(buf)); }
  var parseRJSON = data => Espruino.Core.Utils.parseRJSON(data);
  // ---------------

  // From https://github.com/espruino/EspruinoWebTools/blob/master/uart.js
  /// Base connection class - BLE/Serial add writeLowLevel/closeLowLevel/etc on top of this
  class Connection {
    endpoint = undefined; // Set to the endpoint used for this connection - eg maybe endpoint.name=="Web Bluetooth"
    // on/emit work for close/data/open/error/ack/nak/packet events
    on(evt,cb) { let e = "on"+evt; if (!this[e]) this[e]=[]; this[e].push(cb); } // on only works with a single handler
    emit(evt,data1,data2) { let e = "on"+evt;  if (this[e]) this[e].forEach(fn=>fn(data1,data2)); }
    removeListener(evt,callback) { let e = "on"+evt;  if (this[e]) this[e]=this[e].filter(fn=>fn!=callback); }
    // on("open", () => ... ) connection opened
    // on("close", () => ... ) connection closed
    // on("data", (data) => ... ) when data is received (as string)
    // on("packet", (type,data) => ... ) when a packet is received (if .parsePackets=true)
    // on("ack", () => ... ) when an ACK is received (if .parsePackets=true)
    // on("nak", () => ... ) when an ACK is received (if .parsePackets=true)
    // writeLowLevel(string)=>Promise to be provided by implementor
    // closeLowLevel() to be provided by implementor
    // cb(dataStr) called if defined
    isOpen = false;       // is the connection actually open?
    isOpening = true;     // in the process of opening a connection?
    txInProgress = false; // is transmission in progress?
    txDataQueue = [];     // queue of {data,callback,maxLength,resolve}
    chunkSize = 20;       // Default size of chunks to split transmits into (BLE = 20, Serial doesn't care)
    parsePackets = false; // If set we parse the input stream for Espruino packet data transfers
    received = "";        // The data we've received so far - this gets reset by .write/eval/etc
    hadData = false;      // used when waiting for a block of data to finish being received
    flowControlWait = 0;  // If this is nonzero, we should hold off sending for that number of milliseconds (wait and decrement each time)
    rxDataHandlerLastCh = 0; // used by rxDataHandler - last received character
    rxDataHandlerPacket = undefined; // used by rxDataHandler - used for parsing
    rxDataHandlerTimeout = undefined; // timeout for unfinished packet
    progressAmt = 0;      // When sending a file, how many bytes through are we?
    progressMax = 0;      // When sending a file, how long is it in bytes? 0 if not sending a file

    /// Called when sending data, and we take this (along with progressAmt/progressMax) and create a more detailed progress report
    updateProgress(chars, charsMax) {
      if (chars===undefined) return uart.writeProgress();
      if (this.progressMax)
        uart.writeProgress(this.progressAmt+chars, this.progressMax);
      else
      uart.writeProgress(chars, charsMax);
    }

    /** Called when characters are received. This processes them and passes them on to event listeners */
    rxDataHandler(data) {
      if (!(data instanceof ArrayBuffer)) console.warn("Serial port implementation is not returning ArrayBuffers");
      data = ab2str(data); // now a string!
      log(3, "Received "+JSON.stringify(data));
      if (this.parsePackets) {
        for (var i=0;i<data.length;i++) {
          let ch = data[i];
          // handle packet reception
          if (this.rxDataHandlerPacket!==undefined) {
            this.rxDataHandlerPacket += ch;
            ch = undefined;
            let flags = (this.rxDataHandlerPacket.charCodeAt(0)<<8) | this.rxDataHandlerPacket.charCodeAt(1);
            let len = flags & 0x1FFF;
            let rxLen = this.rxDataHandlerPacket.length;
            if (rxLen>=2 && rxLen>=(len+2)) {
              log(3, "Got packet end");
              if (this.rxDataHandlerTimeout) {
                clearTimeout(this.rxDataHandlerTimeout);
                this.rxDataHandlerTimeout = undefined;
              }
              this.emit("packet", flags&0xE000, this.rxDataHandlerPacket.substring(2));
              this.rxDataHandlerPacket = undefined; // stop packet reception
            }
          } else if (ch=="\x06") { // handle individual control chars
            log(3, "Got ACK");
            this.emit("ack");
            ch = undefined;
          } else if (ch=="\x15") {
            log(3, "Got NAK");
            this.emit("nak");
            ch = undefined;
          } else if (uart.flowControl && ch=="\x11") { // 17 -> XON
            log(2,"XON received => resume upload");
            this.flowControlWait = 0;
          } else if (uart.flowControl && ch=="\x13") { // 19 -> XOFF
            log(2,"XOFF received => pause upload (10s)");
            this.flowControlWait = 10000;
          } else if (ch=="\x10") { // DLE - potential start of packet (ignore)
            this.rxDataHandlerLastCh = "\x10";
            ch = undefined;
          } else if (ch=="\x01" && this.rxDataHandlerLastCh=="\x10") { // SOH
            log(3, "Got packet start");
            this.rxDataHandlerPacket = "";
            this.rxDataHandlerTimeout = setTimeout(()=>{
              this.rxDataHandlerTimeout = undefined;
              log(0, "Packet timeout (2s)");
              this.rxDataHandlerPacket = undefined;
            }, 2000);
            ch = undefined;
          }
          if (ch===undefined) { // if we're supposed to remove the char, do it
            data = data.substring(0,i)+data.substring(i+1);
            i--;
          } else
            this.rxDataHandlerLastCh = ch;
        }
      }
      this.hadData = true;
      if (data.length>0) {
        // keep track of received data
        if (this.received.length < 100000) // ensure we're not creating a memory leak
          this.received += data;
        // forward any data
        if (this.cb) this.cb(data);
        this.emit('data', data);
      }
    }

    /** Called when the connection is opened */
    openHandler() {
      log(1, "Connected");
      this.txInProgress = false;
      this.isOpen = true;
      this.isOpening = false;
      this.received = "";
      this.hadData = false;
      this.flowControlWait = 0;
      this.rxDataHandlerLastCh = 0;
      if (this.isOpen) {
        this.isOpen = false;
        this.emit("open");
      }
      // if we had any writes queued, do them now
      this.write();
    }

    /** Called when the connection is closed - resets any stored info/rejects promises */
    closeHandler() {
      log(1, "Disconnected");
      this.isOpening = false;
      this.txInProgress = false;
      this.txDataQueue = [];
      this.hadData = false;
      if (this.isOpen) {
        this.isOpen = false;
        this.emit("close");
      }
    }

    /** Called to close the connection */
    close() {
      this.closeLowLevel();
      this.closeHandler();
    }

    /** Call this to send data, this splits data, handles queuing and flow control, and calls writeLowLevel to actually write the data.
     * 'callback' can optionally return a promise, in which case writing only continues when the promise resolves
     * @param {string} data
     * @param {() => Promise|void} callback
     * @returns {Promise}
      */
    write(data, callback) {
      let connection = this;
      return new Promise((resolve,reject) => {
        if (data) connection.txDataQueue.push({data:data,callback:callback,maxLength:data.length,resolve:resolve});
        if (connection.isOpen && !connection.txInProgress) writeChunk();

        function writeChunk() {
          if (connection.flowControlWait) { // flow control - try again later
            if (connection.flowControlWait>50) connection.flowControlWait-=50;
            else {
              log(2,"Flow Control timeout");
              connection.flowControlWait=0;
            }
            setTimeout(writeChunk, 50);
            return;
          }
          var chunk;
          if (!connection.txDataQueue.length) {
            uart.writeProgress();
            connection.updateProgress();
            return;
          }
          var txItem = connection.txDataQueue[0];
          uart.writeProgress(txItem.maxLength - (txItem.data?txItem.data.length:0), txItem.maxLength);
          connection.updateProgress(txItem.maxLength - (txItem.data?txItem.data.length:0), txItem.maxLength);
          if (txItem.data.length <= connection.chunkSize) {
            chunk = txItem.data;
            txItem.data = undefined;
          } else {
            chunk = txItem.data.substr(0,connection.chunkSize);
            txItem.data = txItem.data.substr(connection.chunkSize);
          }
          connection.txInProgress = true;
          log(2, "Sending "+ JSON.stringify(chunk));
          connection.writeLowLevel(chunk).then(function() {
            log(3, "Sent");
            let promise = undefined;
            if (!txItem.data) {
              connection.txDataQueue.shift(); // remove this element
              if (txItem.callback)
                promise = txItem.callback();
              if (txItem.resolve)
                txItem.resolve();
            }
            if (!(promise instanceof Promise))
              promise = Promise.resolve();
            connection.txInProgress = false;
            promise.then(writeChunk); // if txItem.callback() returned a promise, wait until it completes before continuing
          }, function(error) {
            log(1, 'SEND ERROR: ' + error);
            uart.writeProgress();
            connection.updateProgress();
            connection.txDataQueue = [];
            connection.close();
          });
        }
      });
    }

    /* Send a packet of type "RESPONSE/EVAL/EVENT/FILE_SEND/DATA" to Espruino
        options = {
          noACK : bool (don't wait to acknowledgement - default=false)
          timeout : int (optional, milliseconds, default=5000) if noACK=false
        }
    */
    espruinoSendPacket(pkType, data, options) {
      options = options || {};
      if (!options.timeout) options.timeout=5000;
      if ("string"!=typeof data) throw new Error("'data' must be a String");
      if (data.length>0x1FFF) throw new Error("'data' too long");
      const PKTYPES = {
        RESPONSE : 0, // Response to an EVAL packet
        EVAL : 0x2000,  // execute and return the result as RESPONSE packet
        EVENT : 0x4000, // parse as JSON and create `E.on('packet', ...)` event
        FILE_SEND : 0x6000, // called before DATA, with {fn:"filename",s:123}
        DATA : 0x8000, // Sent after FILE_SEND with blocks of data for the file
        FILE_RECV : 0xA000 // receive a file - returns a series of PT_TYPE_DATA packets, with a final zero length packet to end
      }
      if (!(pkType in PKTYPES)) throw new Error("'pkType' not one of "+Object.keys(PKTYPES));
      let connection = this;
      return new Promise((resolve,reject) => {
        let timeout;
        function tidy() {
          if (timeout) {
            clearTimeout(timeout);
            timeout = undefined;
          }
          connection.removeListener("ack",onACK);
          connection.removeListener("nak",onNAK);
        }
        function onACK(ok) {
          tidy();
          setTimeout(resolve,0);
        }
        function onNAK(ok) {
          tidy();
          setTimeout(reject,0,"NAK while sending packet");
        }
        if (!options.noACK) {
          connection.parsePackets = true;
          connection.on("ack",onACK);
          connection.on("nak",onNAK);
        }
        let flags = data.length | PKTYPES[pkType];
        connection.write(String.fromCharCode(/*DLE*/16,/*SOH*/1,(flags>>8)&0xFF,flags&0xFF)+data, function() {
          // write complete
          if (options.noACK) {
            setTimeout(resolve,0); // if not listening for acks, just resolve immediately
          } else {
            timeout = setTimeout(function() {
              timeout = undefined;
              tidy();
              reject(`Timeout (${options.timeout}ms) while sending packet`);
            }, options.timeout);
          }
        }, err => {
          tidy();
          reject(err);
        });
      });
    }
    /* Send a file to Espruino using 2v25 packets.
        options = { // mainly passed to Espruino
          fs : true // optional -> write using require("fs") (to SD card)
          noACK : bool // (don't wait to acknowledgements)
          chunkSize : int // size of chunks to send (default 1024) for safety this depends on how big your device's input buffer is if there isn't flow control
          progress : (chunkNo,chunkCount)=>{} // callback to report upload progress
          timeout : int (optional, milliseconds, default=1000)
    } */
    espruinoSendFile(filename, data, options) {
      if ("string"!=typeof data) throw new Error("'data' must be a String");
      let CHUNK = 1024;
      options = options||{};
      options.fn = filename;
      options.s = data.length;
      let packetOptions = {};
      let progressHandler =  (chunkNo,chunkCount)=>{};
      if (options.noACK !== undefined) {
        packetOptions.noACK = !!options.noACK;
        delete options.noACK;
      }
      if (options.chunkSize) {
        CHUNK = options.chunkSize;
        delete options.chunkSize;
      }
      if (options.progress) {
        progressHandler = options.progress;
        delete options.progress;
      }
      options.fs = options.fs?1:0; // .fs => use SD card
      if (!options.fs) delete options.fs; // default=0, so just remove if it's not set
      let connection = this;
      let packetCount = 0, packetTotal = Math.ceil(data.length/CHUNK)+1;
      connection.progressAmt = 0;
      connection.progressMax = data.length;
      // always ack the FILE_SEND
      progressHandler(0, packetTotal);
      return connection.espruinoSendPacket("FILE_SEND",JSON.stringify(options)).then(sendData, err=> {
        connection.progressAmt = 0;
        connection.progressMax = 0;
        throw err;
      });
      // but if noACK don't ack for data
      function sendData() {
        connection.progressAmt += CHUNK;
        progressHandler(++packetCount, packetTotal);
        if (data.length==0) {
          connection.progressAmt = 0;
          connection.progressMax = 0;
          return Promise.resolve();
        }
        let packet = data.substring(0, CHUNK);
        data = data.substring(CHUNK);
        return connection.espruinoSendPacket("DATA", packet, packetOptions).then(sendData, err=> {
          connection.progressAmt = 0;
          connection.progressMax = 0;
          throw err;
        });
      }
    }
    /* Receive a file from Espruino using 2v25 packets.
        options = { // mainly passed to Espruino
          fs : true // optional -> write using require("fs") (to SD card)
          timeout : int // milliseconds timeout (default=2000)
          progress : (bytes)=>{} // callback to report upload progress
        }
    } */
    espruinoReceiveFile(filename, options) {
      options = options||{};
      options.fn = filename;
      if (!options.progress)
        options.progress =  (bytes)=>{};
      let connection = this;
      return new Promise((resolve,reject) => {
        let fileContents = "", timeout;
        function scheduleTimeout() {
          if (timeout) clearTimeout(timeout);
          timeout = setTimeout(() => {
            timeout = undefined;
            cleanup();
            reject("espruinoReceiveFile Timeout");
          }, options.timeout || 2000);
        }
        function cleanup() {
          connection.removeListener("packet", onPacket);
          if (timeout) {
            clearTimeout(timeout);
            timeout = undefined;
          }
        }
        function onPacket(type,data) {
          if (type!=0x8000) return; // ignore things that are not DATA packet
          if (data.length==0) { // 0 length packet = EOF
            cleanup();
            setTimeout(resolve,0,fileContents);
          } else {
            fileContents += data;
            options.progress(fileContents.length);
            scheduleTimeout();
          }
        }
        connection.parsePackets = true;
        connection.on("packet", onPacket);
        scheduleTimeout();
        options.progress(0);
        connection.espruinoSendPacket("FILE_RECV",JSON.stringify(options)).then(()=>{
          // now wait...
        }, err => {
          cleanup();
          reject(err);
        });
      });
    }
    /* Send a JS expression to be evaluated on Espruino using using 2v25 packets.
        options = {
            timeout : int // milliseconds timeout (default=1000)
            stmFix : bool // if set, this works around an issue in Espruino STM32 2v24 and earlier where USB could get in a state where it only sent small chunks of data at a time
        }*/
    espruinoEval(expr, options) {
      options = options || {};
      if ("string"!=typeof expr) throw new Error("'expr' must be a String");
      let connection = this;
      return new Promise((resolve,reject) => {
        let prodInterval;

        function cleanup() {
          connection.removeListener("packet", onPacket);
          if (timeout) {
            clearTimeout(timeout);
            timeout = undefined;
          }
          if (prodInterval) {
            clearInterval(prodInterval);
            prodInterval = undefined;
          }
        }
        function onPacket(type,data) {
          if (type!=0) return; // ignore things that are not a response
          cleanup();
          setTimeout(resolve,0, parseRJSON(data));
        }
        connection.parsePackets = true;
        connection.on("packet", onPacket);
        let timeout = setTimeout(() => {
          timeout = undefined;
          cleanup();
          reject("espruinoEval Timeout");
        }, options.timeout || 1000);
        connection.espruinoSendPacket("EVAL",expr,{noACK:options.stmFix}).then(()=>{
          // resolved/rejected with 'packet' event or timeout
          if (options.stmFix)
            prodInterval = setInterval(function() {
              connection.write(" \x08") // space+backspace
              .catch(err=>{
                console.error("Error sending STM fix:",err);
                cleanup();
              });
            }, 50);
        }, err => {
          cleanup();
          reject(err);
        });
      });
    }
  } // End of Connection class


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
    Espruino.Core.Config.add("STORAGE_UPLOAD_METHOD", {
      section : "Communications",
      name : "Storage Upload Strategy",
      description :
  "On some connections (Serial, >9600 baud) XON/XOFF flow control is too slow to reliably throttle data transfer when writing files, "+
  "and data can be lost. By default we add a delay after each write to Storage to help avoid this, but if your connection is stable "+
  "you can turn this off and greatly increase write speeds.",
      type : {
        0: "Delay Storage writes",
        1: "No delays"
      },
      defaultValue : 0
    });

    var connection = Espruino.Core.Serial.connection;
    connection.cb = (dataStr) => {
      if (readListener) readListener(Espruino.Core.Utils.stringToArrayBuffer(dataStr));
    };
    connection.writeLowLevel = (dataStr) => {
      return new Promise(resolve => currentDevice.write(dataStr, resolve));
    };


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

  /**
   * List ports available over all configured devices.
   * `shouldCallAgain` mean that more devices may appear later on (eg. Bluetooth LE)
   * @param {(ports, shouldCallAgain) => void} callback 
   */
  var getPorts = function (callback) {
    var newPortToDevice = {};

    var devices = Espruino.Core.Serial.devices;
    if (!devices || devices.length == 0) {
      portToDevice = newPortToDevice;
      return callback(ports, false);
    }

    // Test to see if a given port path is ignore or not by configuration
    function isIgnored(path) {
      if (!Espruino.Config.SERIAL_IGNORE) return false;

      return Espruino.Config.SERIAL_IGNORE.split("|").some((wildcard) => {
        const regexp = new RegExp(
          `^${wildcard.replace(/\./g, "\\.").replace(/\*/g, ".*")}$`
        );

        return path.match(regexp);
      });
    }

    // Asynchronously call 'getPorts' on all devices and map results back as a series of promises
    Promise.allSettled(
      devices.map((device) =>
        new Promise((resolve) => device.getPorts(resolve)).then(
          (devicePorts, instantPorts) => ({
            device: device,
            shouldCallAgain: !instantPorts, // If the ports are not present now (eg. BLE) then call again
            value: (devicePorts || [])
              .filter((port) => !isIgnored(port.path)) // Filter out all the ignored ports
              .map((port) => {
                // Map a description for this particular Product/Vendor
                if (port.usb && port.usb[0] == 0x0483 && port.usb[1] == 0x5740)
                  port.description = "Espruino board";
                return port;
              }),
          })
        )
      )
    ).then((devicePromises) => {
      // Reduce the responses to only promises that were fulfilled
      const successfulPorts = devicePromises.reduce((acc, promise) => {
        if (promise.status === "fulfilled") acc.push(promise.value);
        return acc;
      }, []);

      portToDevice = devicePromises.reduce((acc, promise) => {
        if (promise.status === "fulfilled")
          promise.value.value.forEach(
            (port) => (acc[port.path] = promise.value.device)
          );

        return acc;
      }, {});

      callback(
        successfulPorts
          .map((val) => val.value)
          .reduce((acc, port) => acc.concat(port), []),
        successfulPorts.some((val) => val.shouldCallAgain)
      );
    });
  };

  var openSerial=function(serialPort, connectCallback, disconnectCallback) {
    Espruino.Core.Serial.setSlowWrite(true); // force slow write to ensure things work ok - we may disable this when versionChecker figures out what board/version we use
    return openSerialInternal(serialPort, connectCallback, disconnectCallback, 5);
  }

  var openSerialInternal=function(serialPort, connectCallback, disconnectCallback, attempts) {
    /* If openSerial is called, we need to have called getPorts first
    in order to figure out which one of the serial_ implementations
    we must call into. */
    if (portToDevice === undefined) {
      portToDevice = {}; // stop recursive calls if something errors
      return getPorts(function() {
        openSerialInternal(serialPort, connectCallback, disconnectCallback, attempts);
      });
    }

    if (!(serialPort in portToDevice)) {
      if (serialPort.toLowerCase() in portToDevice) {
        serialPort = serialPort.toLowerCase();
      } else {
        if (attempts>0) {
          console.log("serial: Port "+JSON.stringify(serialPort)+" not found - checking ports again ("+attempts+" attempts left)");
          setTimeout(function() {
            getPorts(function() {
              openSerialInternal(serialPort, connectCallback, disconnectCallback, attempts-1);
            });
          }, 500);
          return;
        } else {
          console.error("serial: Port "+JSON.stringify(serialPort)+" not found");
          return connectCallback(undefined);
        }
      }
    }

    Espruino.Core.Serial.connection.isOpen = false;
    Espruino.Core.Serial.connection.isOpening = true;
    var portInfo = { port:serialPort };
    var connectionInfo = undefined;
    currentDevice = portToDevice[serialPort];
    currentDevice.open(serialPort, function(cInfo) {  // CONNECT
      if (!cInfo) {
//        Espruino.Core.Notifications.error("Unable to connect");
        console.error("Unable to open device (connectionInfo="+cInfo+")");
        connectCallback(undefined);
        connectCallback = undefined;
        currentDevice = undefined;
      } else {
        connectionInfo = cInfo;
        Espruino.Core.Serial.connection.isOpen = true;
        Espruino.Core.Serial.connection.isOpening = false;
        console.log("serial: Connected", cInfo);
        if (connectionInfo.portName)
          portInfo.portName = connectionInfo.portName;
        Espruino.callProcessor("connected", portInfo, function() {
          connectCallback(cInfo);
          connectCallback = undefined;
        });
      }
    }, buf => Espruino.Core.Serial.connection.rxDataHandler(buf), // RECEIEVE DATA
    function(error) { // DISCONNECT
      currentDevice = undefined;
      Espruino.Core.Serial.connection.closeHandler();
      sendingBinary = false;
      if (connectCallback) {
        // we got a disconnect when we hadn't connected...
        // Just call connectCallback(undefined), don't bother sending disconnect
        connectCallback(error);
        connectCallback = undefined;
        connectionInfo = undefined;
        return;
      }
      Espruino.callProcessor("disconnected", portInfo, function() {
        if (disconnectCallback) disconnectCallback(portInfo);
        disconnectCallback = undefined;
      });
    });
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

  var findSplitIdx = function(data, prev, substr, delay, reason) {
    var match = data.match(substr);
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

  var writeSerialWorker = function(writeData) {
    var blockSize = 512;
    if (currentDevice.maxWriteLength)
      blockSize = currentDevice.maxWriteLength;
    /* if we're throttling our writes we want to send small
      * blocks of data at once. We still limit the size of
      * sent blocks to 512 because on Mac we seem to lose
      * data otherwise (not on any other platforms!) */
    if (slowWrite) blockSize=19;
    writeData.blockSize = blockSize;

    writeData.showStatus &= writeData.data.length>writeData.blockSize;
    if (writeData.showStatus) {
      Espruino.Core.Status.setStatus("Sending...", writeData.data.length);
      console.log("serial: ---> "+JSON.stringify(writeData.data));
    }

    while (writeData.data.length>0) {
      let d = undefined;
      let split = writeData.nextSplit || { start:0, end:writeData.data.length, delay:0 };
      // if we get something like Ctrl-C or `reset`, wait a bit for it to complete
      if (!sendingBinary) {
        split = findSplitIdx(writeData.data, split, /\x03/, 250, "Ctrl-C"); // Ctrl-C
        split = findSplitIdx(writeData.data, split, /reset\(\);?\n/, 250, "reset()"); // Reset
        split = findSplitIdx(writeData.data, split, /load\(\);?\n/, 250, "load()"); // Load
        split = findSplitIdx(writeData.data, split, /Modules.addCached\("[^\n]*"\);?\n/, 250, "Modules.addCached"); // Adding a module
        if ((0|Espruino.Config.STORAGE_UPLOAD_METHOD)==0) // only throttle writes if we haven't disabled it
          split = findSplitIdx(writeData.data, split, /require\("Storage"\).write\([^\n]*\);?\n/, 250, "Storage.write"); // Write chunk of data
      }
      if (split.match) console.log("serial: Splitting for "+split.reason+", delay "+split.delay);
      // Only send some of the data
      if (writeData.data.length>split.end) {
        if (slowWrite && split.delay==0) split.delay=50;
        d = writeData.data.substr(0,split.end);
        writeData.data = writeData.data.substr(split.end);
        if (writeData.nextSplit) {
          writeData.nextSplit.start -= split.end;
          writeData.nextSplit.end -= split.end;
          if (writeData.nextSplit.end<=0)
            writeData.nextSplit = undefined;
        }
      } else {
        d = writeData.data;
        writeData.data = "";
        writeData.nextSplit = undefined;
      }

      let isLast = writeData.data.length == 0;
      // update status
      if (writeData.showStatus)
        Espruino.Core.Status.incrementProgress(d.length);
      // actually write data
      //console.log("serial: Sending block "+JSON.stringify(d)+", wait "+split.delay+"ms");
      Espruino.Core.Serial.connection.write(d, function() { // write data, but the callback returns a promise that delays
        return new Promise(resolve => setTimeout(function() {
          if (isLast && writeData.showStatus) {
            Espruino.Core.Status.setStatus("Sent");
            if (writeData.callback)
              writeData.callback();
          }
          resolve();
        }, split.delay));
      });
    }
  }

   // Throttled serial write
  var writeSerial = function(data, showStatus, callback) {
    if (showStatus===undefined) showStatus=true;
    writeSerialWorker({data:data,callback:callback,showStatus:showStatus});
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
      var SERIAL_THROTTLE_SEND = 0|Espruino.Config.SERIAL_THROTTLE_SEND;
      var reason = "";
      if (force) {
        reason = "(forced)";
      } else if (SERIAL_THROTTLE_SEND==1) {
        reason = "('Throttle Send'='Always')";
        isOn = true;
      } else  if (SERIAL_THROTTLE_SEND==2) {
        reason = "('Throttle Send'='Never')";
        isOn = false;
      } else
        reason =  "('Throttle Send'='Auto')";
      console.log(`serial: Set Slow Write = ${isOn} ${reason}`);
      slowWrite = isOn;
    },
    "setBinary": function(isOn) {
      sendingBinary = isOn;
    },
    "connection": new Connection()
  };
})();
