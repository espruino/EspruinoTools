#!/usr/bin/env node
/* Entrypoint for node module command-line app. Not used for Web IDE */
var fs = require("fs");

function getHelp() {
  return [
   "USAGE: espruino ...options... [file_to_upload.js]",
   "",
   "  -h,--help                : Show this message",
   "  -j [job.json]            : Load options from JSON job file - see configDefaults.json",
   "                               Calling without a job filename creates a new job file ",
   "                               named after the uploaded file",
   "  -v,--verbose             : Verbose",
   "  -q,--quiet               : Quiet - apart from Espruino output",
   "  -m,--minify              : Minify the code before sending it",
   "  -t,--time                : Set Espruino's time when uploading code",
   "  -w,--watch               : If uploading a JS file, continue to watch it for",
   "                               changes and upload again if it does.",
   "  -e command               : Evaluate the given expression on Espruino",
   "                               If no file to upload is specified but you use -e,",
   "                               Espruino will not be reset",
   "  --sleep 10               : Sleep for the given number of seconds after uploading code",
   "  -n                       : Do not connect to Espruino to upload code",
   "  --board BRDNAME/BRD.json : Rather than checking on connect, use the given board name or file",
   "  --ide [8080]             : Serve up the Espruino Web IDE on the given port. If not specified, 8080 is the default.",
   "",
   "  -p,--port /dev/ttyX      : Connect to a serial port",
   "  -p,--port aa:bb:cc:dd:ee : Connect to a Bluetooth device by addresses",
   "  -p,--port tcp://192.168.1.50 : Connect to a network device (port 23 default)",
   "  -d deviceName            : Connect to the first device with a name containing deviceName",
   "  --download fileName      : Download a file with the name matching fileName to the current directory",
   "  -b baudRate              : Set the baud rate of the serial connection",
   "                               No effect when using USB, default: 9600",
   "  --no-ble                 : Disables Bluetooth Low Energy (using the 'noble' module)",
   "  --list                   : List all available devices and exit",
   "",
   "  --listconfigs            : Show all available config options and exit",
   "  --config key=value       : Set internal Espruino config option",
   "",
   "  -o out.js                : Write the actual JS code sent to Espruino to a file",
   "  --ohex out.hex           : Write the JS code to a hex file as if sent by E.setBootCode",
   "  --storage fn:data.bin    : Load 'data.bin' from disk and write it to Storage as 'fn'",
   "  --storage .boot0:-       : Store program code in the given Storage file (not .bootcde)",
   "",
   "  -f firmware.bin[:N]      : Update Espruino's firmware to the given file",
   "                               Must be a USB Espruino in bootloader mode",
   "                               (bluetooth is not currently supported).",
   "                               Optionally skip N first bytes of the bin file.",
   "",
   "If no file, command, or firmware update is specified, this will act",
   "as a terminal for communicating directly with Espruino. Press Ctrl-C",
   "twice to exit.",
   "",
   "Please report bugs via https://github.com/espruino/EspruinoTools/issues",
   ""]
}

//override default console.log
var log = console.log;
console.log = function() {
 if (args.verbose)
   log.apply(console, arguments);
}
//Parse Arguments
var args = {
 ports: [], // ports to try and connect to
 config: {}, // Config defines to set when running Espruino tools
 storageContents : {} // Storage files to save when using ohex
};

var isNextValidNumber = function(next) {
 return next && isFinite(parseFloat(next));
}
var isNextValidPort = function(next) {
 return next && next[0]!=='-' && next.indexOf(".js") == -1;
}
var isNextValidFileType = function(next, fileType) {
 return next && next[0]!=='-' && next.indexOf(fileType) >= 0;
}
var isNextValidJSON = function(next) {
 return isNextValidFileType(next, ".json");
}
var isNextValidHEX = function(next) {
 return isNextValidFileType(next, ".hex");
}
var isNextValidJS = function(next) {
 return next && !isNextValidJSON(next) && next.indexOf(".js") >= 0;
}
var isNextValid = function(next) {
 return next && next[0]!=='-';
}

for (var i=2;i<process.argv.length;i++) {
 var arg = process.argv[i];
 var next = process.argv[i+1];
 if (arg[0]=="-") {
   if (arg=="-h" || arg=="--help") args.help = true;
   else if (arg=="-v" || arg=="--verbose") args.verbose = true;
   else if (arg=="-q" || arg=="--quiet") args.quiet = true;
   else if (arg=="-c" || arg=="--color") args.color = true;
   else if (arg=="-m" || arg=="--minify") args.minify = true;
   else if (arg=="-t" || arg=="--time") args.setTime = true;
   else if (arg=="-w" || arg=="--watch") args.watchFile = true;
   else if (arg=="-n" || arg=="--nosend") args.nosend = true;
   else if (arg=="--no-ble") args.noBle = true;
   else if (arg=="--list") args.showDevices = true;
   else if (arg=="--listconfigs") args.showConfigs = true;
   else if (arg=="-p" || arg=="--port") {
     args.ports.push({type:"path",name:next});
     var j = (++i) + 1;
     while (isNextValidPort(process.argv[j])) {
       args.ports.push({type:"path",name:process.argv[j++]});
       i++;
     }
     if (!isNextValidPort(next)) throw new Error("Expecting a port argument to -p, --port");
   } else if (arg=="-d") {
     i++; args.ports.push({type:"name",name:next});
     if (!isNextValid(next)) throw new Error("Expecting a name argument to -d");
   } else if (arg=="--download") {
     i++; args.fileToDownload = next;
     if (!isNextValid(next)) throw new Error("Expecting a file name argument to --download");
   } else if (arg=="--config") {
     i++;
     if (!next || next.indexOf("=")==-1) throw new Error("Expecting a key=value argument to --config");
     var kidx = next.indexOf("=");
     try {
       args.config[next.substr(0,kidx)] = JSON.parse(next.substr(kidx+1));
     } catch (e) {
       // treat as a string
       args.config[next.substr(0,kidx)] = next.substr(kidx+1);
     }
   } else if (arg=="-e") {
     i++; args.expr = next;
     if (!isNextValid(next)) throw new Error("Expecting an expression argument to -e");
   } else if (arg=="-b") {
     i++; args.baudRate = parseInt(next);
     if (!isNextValid(next) || isNaN(args.baudRate)) throw new Error("Expecting a numeric argument to -b");
   } else if (arg=="-j") {
     args.job = "";                                          // will trigger makeJobFile
     if (isNextValidJSON(next)) { i++; args.job =  next; };  // optional
   } else if (arg=="-o") {
     i++; args.outputJS = next;
     if (!isNextValidJS(next)) throw new Error("Expecting a JS filename argument to -o");
   } else if (arg=="--ohex" || arg=="-ohex"/* backwards compat.*/) {
     i++; args.outputHEX = next;
     if (!isNextValidHEX(next)) throw new Error("Expecting a .hex file argument to --ohex");
   } else if (arg=="--storage") {
     i++; var d = next.split(":");
     if (!next || next.indexOf(":")<0) throw new Error("Expecting a fn:file.bin argument to --storage");
     args.storageContents[d[0]] = d[1];
   } else if (arg=="-f") {
     i++; var arg = next;
     if (!isNextValid(next)) throw new Error("Expecting a filename argument to -f");
     arg = arg.split(':', 2);
     args.updateFirmware = arg[0];
     args.firmwareFlashOffset = parseInt(arg[1] || '0');
     if (isNaN(args.firmwareFlashOffset)) throw new Error("Expecting a numeric offset for -f");
   } else if (arg=="--board") {
     i++; args.board = next;
     if (!isNextValid(next)) throw new Error("Expecting an argument to --board");
   } else if (arg=="--ide") {
     args.ideServer = 8080;
     if (isFinite(parseInt(next))) {
       args.ideServer = parseInt(next);
       i++;
     }
   } else if (arg=="--sleep") {
     i++; args.sleepAfterUpload = parseFloat(next);
     if (!isNextValidNumber(next)) throw new Error("Expecting a number argument to --sleep");
   } else throw new Error("Unknown Argument '"+arg+"', try --help");
 } else {
   if ("file" in args)
     throw new Error("File already specified as '"+args.file+"'");
   args.file = arg;
 }
}

// job file injection...
 if (args.job) {
   var job = fs.readFileSync(args.job, {encoding:"utf8"});  // read the job file
   var config = JSON.parse(job);
   for (var key in config) args[key] = config[key];
 }

//Extra argument stuff
args.espruinoPrefix = args.quiet?"":"--] ";
args.espruinoPostfix = "";
if (args.color) {
 args.espruinoPrefix = "\033[32m";
 args.espruinoPostfix = "\033[0m";
}
//this is called after Espruino tools are loaded, and
//sets up configuration as requested by the command-line options
function setupConfig(Espruino, callback) {
 if (args.minify)
   Espruino.Config.MINIFICATION_LEVEL = "ESPRIMA";
 if (args.baudRate && !isNaN(args.baudRate))
   Espruino.Config.BAUD_RATE = args.baudRate;
 if (args.noBle)
   Espruino.Config.BLUETOOTH_LOW_ENERGY = false;
 if (args.setTime)
   Espruino.Config.SET_TIME_ON_WRITE = true;
 if (args.watchFile && !args.file)
   throw new Error("--watch specified, with no file to watch!");
 if (args.updateFirmware && (args.file || args.expr))
   throw new Error("Can't update firmware *and* upload code right now.");
 if (args.espruino) {  // job file injections
   for (var key in args.espruino) Espruino.Config[key] = args.espruino[key];
 }
 if (args.outputHEX) {
   log("--ohex used - enabling MODULE_AS_FUNCTION");
   Espruino.Config.MODULE_AS_FUNCTION = true;
 }
 if (Object.keys(args.storageContents).length) {
  for (var storageName in args.storageContents) {
    var fileName = args.storageContents[storageName];
    if (fileName=="-")
      args.storageContents[storageName] = { code : true };
    else {
      args.storageContents[storageName] = { data: fs.readFileSync(fileName, {encoding:"utf8"}).toString() };
    }
  }
 }
 if (args.config) {
   for (var key in args.config) {
     console.log("Command-line option set Espruino.Config."+key+" to "+JSON.stringify(args.config[key]));
     Espruino.Config[key] = args.config[key];
   }
 }
 if ( args.ports && args.ports.length ) {
   Espruino.Config.SERIAL_TCPIP=args.ports
    .filter(function(p) {
      return p.name.substr(0,6) === "tcp://";
    })
    .map(function(p) {
      return p.name.trim();
    }
   )
 }
 if (args.showConfigs) {
   Espruino.Core.Config.getSections().forEach(function(section) {
     log(" "+section.name);
     log("==================================".substr(0,section.name.length+2));
     log("");
     if (section.description) {
       log(section.description);
       log("");
     }
     var configItems = Espruino.Core.Config.data;
     for (var configName in configItems) {
       var configItem = configItems[configName];
       if (configItem.section == section.name) {
         var d = configItem.name+" ("+configName+")";
         log(d);
         log("-------------------------------------------------------------------------------".substr(0,d.length+2));
         if (configItem.description) log(configItem.description);
         log("Type: "+JSON.stringify(configItem.type,null,2));
         log("Default: --config "+configName+"="+configItem.defaultValue);
         log("Current: --config "+configName+"="+Espruino.Config[configName]);
         log("");
       }
     }
     log("");
   });
   process.exit(1);
   //Espruino.Core.Config.getSection(sectionName);
 }
 if (args.board) {
   log("Explicit board JSON supplied: "+JSON.stringify(args.board));
   var jsonLoaded = function(json) {
     console.log("Manual board JSON load complete");
     if (json && json.info && json.info.binary_version)
       Espruino.Core.Env.setFirmwareVersion(json.info.binary_version);
     callback();
   }
   Espruino.Config.ENV_ON_CONNECT = false;
   var env = Espruino.Core.Env.getData();
   env.BOARD = args.board;
   if (args.board.indexOf(".")>=0) {
     var data = JSON.parse(require("fs").readFileSync(args.board).toString());
     for (var key in data)
       env[key] = data[key];
     Espruino.callProcessor("boardJSONLoaded", env, jsonLoaded);
   } else { // download the JSON
     Espruino.Plugins.BoardJSON.loadJSON(env, Espruino.Config.BOARD_JSON_URL+"/"+env.BOARD+".json", jsonLoaded);
   }
 } else callback();
}

/* Write a file into a Uint8Array in the form that Espruino expects. Return the
address of the next file.
NOTE: On platforms with only a 64 bit write (STM32L4) this won't work */
function setStorageBufferFile(buffer, addr, filename, data) {
  if (!typeof data=="string") throw "Expecting string";
  if (addr&3) throw "Unaligned";
  var fileSize = data.length;
  var nextAddr = addr+32+((fileSize+3)&~3);
  if (nextAddr>buffer.length) throw "File too big for buffer";
  // https://github.com/espruino/Espruino/blob/master/src/jsflash.h#L30
  // 'size'
  buffer.set([fileSize&255, (fileSize>>8)&255,
              (fileSize>>16)&255, (fileSize>>24)&255], addr);
  // 'replacement' - none, since this is the only file
  // 'filename', 8 bytes
  if (filename.length>28) throw "Filename "+JSON.stringify(filename)+" too big";
  buffer.set([0,0,0,0,0,0,0,0,
              0,0,0,0,0,0,0,0,
              0,0,0,0,0,0,0,0,
              0,0,0,0], addr+4);
  for (var i=0;i<filename.length;i++)
    buffer[addr+4+i] = filename.charCodeAt(i);
  // Write the data in
  for (var i=0;i<fileSize;i++)
    buffer[addr+32+i] = data.charCodeAt(i);
  // return next addr
  return nextAddr;
}

/* Convert the given files to the format used by the Storage module,
and return the Intel Hex file for it all. */
function toIntelHex(files) {
  var saveAddress, saveSize;
  try {
    saveAddress = Espruino.Core.Env.getData().chip.saved_code.address;
    saveSize = Espruino.Core.Env.getData().chip.saved_code.page_size *
               Espruino.Core.Env.getData().chip.saved_code.pages;
  } catch (e) {
    throw new Error("Board JSON not found or doesn't contain the relevant saved_code section");
  }
  var buffer = new Uint8Array(saveSize);
  buffer.fill(0xFF); // fill with 255 for emptiness
  var offset = 0;
  for (var filename in files) {
    console.log(`Storage: set ${JSON.stringify(filename)} at ${offset} (${files[filename].length} bytes)`);
    offset = setStorageBufferFile(buffer, offset, filename, files[filename]);
  }
  if (offset>saveSize)
    throw new Error(`Too much code to save (${offset} vs ${saveSize} bytes)`);
  // Now work out intel hex
  function h(d) { var n = "0123456789ABCDEF"; return n[(d>>4)&15]+n[d&15]; }
  function ihexline(bytes) {
    bytes.push(1+(~bytes.reduce((a,b)=>a+b)&255)); // checksum - yay JS!
    return ":"+bytes.map(h).join("")+"\r\n";
  }
  var lastHighAddr = -1;
  var ihex = "";
  for (var idx=0;idx<saveSize;idx+=16) {
    var addr = saveAddress+idx;
    var highAddr = addr>>16;
    if (highAddr != lastHighAddr) {
      lastHighAddr = highAddr;
      ihex += ihexline([2,0,0,4,(highAddr>>8)&255,highAddr&255]);
    }
    var bytes = [
      16/*bytes*/,
      (addr>>8)&0xFF, addr&0xFF,
      0]; // record type
    for (var j=0;j<16;j++) bytes.push(buffer[idx+j]);
    ihex += ihexline(bytes);
  }
  // END OF FILE marker (so don't copy this if you're trying to manually merge files!)
  ihex += ":00000001FF\r\n";
  return ihex;
}

// create a job file from commandline settings
function makeJobFile(config) {
  var job = {"espruino":{}};
  // assign commandline values
  for (var key in args) {
    switch (key) {
      case 'job': // remove job itself, and others set internally from the results
      case 'espruinoPrefix':
      case 'espruinoPostfix':
        break;
      default: job[key] = args[key];  // otherwise just output each key: value
    }
    // write fields of Espruino.Config passed as config
    for (var k in config) { if (typeof config[k]!=='function') job.espruino[k] = config[k]; };
  }
  // name job file same as code file with json ending or default and save.
  var jobFile = isNextValidJS(args.file) ? args.file.slice(0,args.file.lastIndexOf('.'))+'.json' : "job.json";

  if (!fs.existsSync(jobFile)) {
    log("Creating job file "+JSON.stringify(jobFile));
    fs.writeFileSync(jobFile,JSON.stringify(job,null,2),{encoding:"utf8"});
  } else
    log("WARNING: File "+JSON.stringify(jobFile)+" already exists - not overwriting.");
}

//header
if (!args.quiet) {
 var pjson = require(__dirname+'/../package.json');
 console.log(pjson.version);
 log(
   "Espruino Command-line Tool "+pjson.version+"\n"+
   "-----------------------------------\n"+
   "");
}

//Help
if (args.help) {
 getHelp().forEach(function(l) {log(l);});
 process.exit(1);
}

function sendCode(callback) {
  var code = "";
  if (args.file) {
    code = fs.readFileSync(args.file, {encoding:"utf8"});
  }
  if (args.expr) {
    if (code) {
      if (code[code.length-1]!="\n")
        code += "\n";
    } else
      Espruino.Config.RESET_BEFORE_SEND = false;
    code += args.expr+"\n";
  }
  if (Object.keys(args.storageContents).length && !code) {
    code += "\n";
  }
  if (code) {
    var env = Espruino.Core.Env.getData();
    if (!env.info || !env.info.builtin_modules) {
      log("********************************************************************");
      log("* No list of built-in modules found. If you get 'Module not found' *");
      log("* messages for built-in modules you may want to connect to a board *");
      log("* with '-p devicePath' or use '--board BOARDNAME'                  *");
      log("********************************************************************");
    }
    if (!args.outputHEX) {
      // if we're supposed to upload code somewhere ensure we do that properly
      for (var storageName in args.storageContents) {
        var storageContent = args.storageContents[storageName];
        if (storageContent.code) {
          Espruino.Config.SAVE_ON_SEND = 3; // to storage file
          Espruino.Config.SAVE_STORAGE_FILE = storageName; // the filename
          Espruino.Config.LOAD_STORAGE_FILE = 2; // Load the Storage File just written to
        }
      }
    }
    Espruino.callProcessor("transformForEspruino", code, function(code) {
      if (args.outputHEX) {
        log("Writing hex output to "+args.outputHEX);
        var storage = {}
        var hadCode = false;
        for (var storageName in args.storageContents) {
          var storageContent = args.storageContents[storageName];
          if (storageContent.code) {
            storage[storageName] = code;
            hadCode = true;
          } else {
            storage[storageName] = storageContent.data;
          }
        }
        // add code in default place
        if (!hadCode) storage[".bootcde"]=code;
        require("fs").writeFileSync(args.outputHEX, toIntelHex(storage));
      } else {
        // if not creating a hex, we just add the code needed to upload
        // files to the beginning of what we upload
        for (var storageName in args.storageContents) {
          var storageContent = args.storageContents[storageName];
          if (!storageContent.code) {
            code = Espruino.Core.Utils.getUploadFileCode(storageName, storageContent.data)+"\n" + code;
          }
        }
      }
      if (args.outputJS) {
        log("Writing output to "+args.outputJS);
        require("fs").writeFileSync(args.outputJS, code);
      }
      if (!args.nosend)
        Espruino.Core.CodeWriter.writeToEspruino(code, function() {
          if (args.sleepAfterUpload) {
            log("Upload Complete. Sleeping for "+args.sleepAfterUpload+"s");
            setTimeout(callback, args.sleepAfterUpload*1000);
          } else {
            log("Upload Complete");
            callback();
          }
        });
      else
        callback();
    });
  } else {
    callback();
  }
}

/* Download a file from Espruino */
function downloadFile(callback) {
  Espruino.Core.Utils.downloadFile(args.fileToDownload, function(contents) {
    if (contents===undefined) {
      log("Timed out receiving file")
      if (!args.file && !args.updateFirmware && !args.expr) return process.exit(0);
      if (callback) return callback();
    }

    //Write file to current directory
    require("fs").writeFileSync(args.fileToDownload, contents);
    log(`"${args.fileToDownload}" successfully downloaded.`);
    if (!args.file && !args.updateFirmware && !args.expr) return process.exit(0);
    if (callback) return callback();
  });
}

/* Connect and send file/expression/etc */
function connect(devicePath, exitCallback) {
  if (args.ideServer) log("WARNING: --ide specified, but no terminal. Don't specify a file/expression to upload.");
  if (!args.quiet && !args.nosend) log("Connecting to '"+devicePath+"'");
  var currentLine = "";
  var exitTimeout;
  // Handle received data
  Espruino.Core.Serial.startListening(function(data) {
   data = String.fromCharCode.apply(null, new Uint8Array(data));
   currentLine += data;
   while (currentLine.indexOf("\n")>=0) {
     var i = currentLine.indexOf("\n");
     log(args.espruinoPrefix + currentLine.substr(0,i)+args.espruinoPostfix);
     currentLine = currentLine.substr(i+1);
   }
   // if we're waiting to exit, make sure we wait until nothing has been printed
   if (exitTimeout && exitCallback) {
     clearTimeout(exitTimeout);
     exitTimeout = setTimeout(exitCallback, 500);
   }
  });
  if (!args.nosend) {
    Espruino.Core.Serial.open(devicePath, function(status) {
      if (status === undefined) {
        console.error("Unable to connect!");
        return exitCallback();
      }
      if (!args.quiet) log("Connected");
      // Do we need to update firmware?
      if (args.updateFirmware) {
        var bin = fs.readFileSync(args.updateFirmware, {encoding:"binary"});
        var flashOffset = args.firmwareFlashOffset || 0;
        Espruino.Core.Flasher.flashBinaryToDevice(bin, flashOffset, function(err) {
          log(err ? "Error!" : "Success!");
          exitTimeout = setTimeout(exitCallback, 500);
        });
      } else {
        // Is there a file we should download?
        if (args.fileToDownload) {
          // figure out what code we need to send (if any) and download the file
          sendCode(function() {
            downloadFile(function() {
              exitTimeout = setTimeout(exitCallback, 500);
            });
          });
        } else {
          // figure out what code we need to send (if any)
          sendCode(function() {
            exitTimeout = setTimeout(exitCallback, 500);
          });
        }
      }
      // send code over here...

      // ----------------------
     }, function() {
       log("Disconnected.");
       exitCallback();
     });
  } else {
    sendCode(function() {
      exitTimeout = setTimeout(exitCallback, 500);
    });
  }
}

function sendOnFileChanged() {
  var busy = false;
  var watcher = require("fs").watch(args.file, { persistent : false }, function(eventType) {
    if (busy) return;
    /* stop watching - some apps delete & recreate, so continuing
     to watch would break */
    if (watcher) watcher.close();
    watcher = undefined;
    busy = true;
    console.log(args.file+" changed, reloading");
    setTimeout(function() {
      sendCode(function() {
        console.log("File sent!");
        busy = false;
        // start watching again
        sendOnFileChanged();
      });
    }, 500);
  });
}

/* Start a webserver for the Web IDE */
function startWebIDEServer(writeCallback) {
  var httpPort = args.ideServer;
  var server = require("http").createServer(function(req, res) {
    res.end(`<html>
<body style="margin:0px">
<iframe id="ideframe" src="https://www.espruino.com/ide/" style="width:100%;height:100%;border:0px;"></iframe>
<script src="https://www.espruino.com/ide/embed.js"></script>
<script>
  var ws = new WebSocket("ws://" + location.host + "/ws", "serial");
  var Espruino = EspruinoIDE(document.getElementById('ideframe'));
  Espruino.onports = function() {
    return [{path:'local', description:'Connected Device', type : "net"}];
  };
  Espruino.onready = function(data) { Espruino.connect("local");};
  Espruino.onwrite = function(data) { ws.send(data); }
  ws.onmessage = function (event) { Espruino.received(event.data); };
  ws.onclose = function (event) { Espruino.disconnect(); };
</script>
</body>
</html>
`);
  });
  server.listen(httpPort);
  log("Web IDE is now available on http://localhost:"+httpPort);
  /* Start the WebSocket relay - allows standard Websocket MQTT communications */
  var WebSocketServer = require('websocket').server;
  var wsServer = new WebSocketServer({
    httpServer: server,
    autoAcceptConnections: false
  });
  var ideConnections = [];
  wsServer.on('request', function(request) {
    // request.reject() based on request.origin?
    var connection = request.accept('serial', request.origin);
    ideConnections.push(connection);
    log('Web IDE Connection accepted.');
    connection.on('message', function(message) {
      if (message.type === 'utf8') writeCallback(message.utf8Data);
    });
    connection.on('close', function(reasonCode, description) {
      log('Web IDE Connection closed.');
      var conIdx = ideConnections.indexOf(connection);
      if (conIdx>=0) ideConnections.splice(conIdx,1);
    });
  });

  return {
    write : function(data) {
      ideConnections.forEach(function(connection) { connection.sendUTF(data) });
    }
  };
}

/* Connect and enter terminal mode */
function terminal(devicePath, exitCallback) {
  if (!args.quiet) log("Connecting to '"+devicePath+"'");
  var hadCtrlC = false;
  var hadCR = false;
  var ideServer = undefined;
  process.stdin.setRawMode(true);
  Espruino.Core.Serial.startListening(function(data) {
    data = new Uint8Array(data);
    var dataStr = String.fromCharCode.apply(null, data);
    if (ideServer) ideServer.write(dataStr);

    process.stdout.write(dataStr);
    /* If Espruino responds after a Ctrl-C with anything other
     than a blank prompt, make sure the next Ctrl-C will exit */
    for (var i=0;i<data.length;i++) {
      var ch = data[i];
      if (ch==8) hadCR = true;
      else {
        if (hadCtrlC && (ch!=62 /*>*/ || !hadCR)) {
          //process.stdout.write("\nCTRLC RESET BECAUSE OF "+JSON.stringify(String.fromCharCode.apply(null, data))+"  "+hadCR+" "+ch+"\n");
          hadCtrlC = false;
        }
        hadCR = false;
      }
    }
  });
  Espruino.Core.Serial.open(devicePath, function(status) {
    if (status === undefined) {
      console.error("Unable to connect!");
      return exitCallback();
    }
    if (!args.quiet) log("Connected");
    process.stdin.on('data', function(chunk) {
      if (chunk !== null) {
        chunk = chunk.toString();
        Espruino.Core.Serial.write(chunk);
        // Check for two Ctrl-C in a row (without Espruino doing anything inbetween)
        for (var i=0;i<chunk.length;i++) {
          var ch = chunk.charCodeAt(i);
          if (ch==3) {
            if (hadCtrlC) {
              process.stdout.write("\r\n");
              exitCallback();
            } else {
              // if we had ctrl-c, but didn't receive anything
              setTimeout(function() {
                if (hadCtrlC) process.stdout.write("\nPress Ctrl-C again to exit\n>");
              }, 200);
            }
            hadCtrlC = true;
          }
        }
      }
    });
    process.stdin.on('end', function() {
      console.log("STDIN ended. exiting...");
      exitCallback();
    });

    if (args.ideServer)
      ideServer = startWebIDEServer(function(data) {
        Espruino.Core.Serial.write(data);
      });

    if (args.fileToDownload) {
      // figure out what code we need to send (if any) and download the file
      sendCode(function() {
        downloadFile(function() {
          if (args.watchFile) sendOnFileChanged();
        });
      });
    }
    else {
      // figure out what code we need to send (if any)
      sendCode(function() {
        if (args.watchFile) sendOnFileChanged();
      });
    }
   }, function() {
     log("\nDisconnected.");
     exitCallback();
   });
}

/* If the user's asked us to find a device by name, list
all devices and search */
function getPortPath(port, callback) {
  if (port.type=="path") callback(port.name);
  else if (port.type=="name") {
    log("Searching for device named "+JSON.stringify(port.name));
    var searchString = port.name.toLowerCase();
    var timeout = 5;
    Espruino.Core.Serial.getPorts(function cb(ports, shouldCallAgain) {
      //log(JSON.stringify(ports,null,2));
      var found = ports.find(function(p) { return p.description && p.description.toLowerCase().indexOf(searchString)>=0; });
      if (found) {
        log("Found "+JSON.stringify(found.description)+" ("+JSON.stringify(found.path)+")");
        callback(found.path);
      } else {
        if (timeout-- > 0 && shouldCallAgain) // try again - sometimes BLE devices take a while
          setTimeout(function() {
            Espruino.Core.Serial.getPorts(cb);
          }, 500);
        else {
         log("Port named "+JSON.stringify(port.name)+" not found");
         process.exit(1);
       }
      }
    });
  } else throw new Error("Unknown port type! "+JSON.stringify(port));
}

function tasksComplete() {
  console.log("Done");
  process.exit(0);
}

function startConnect() {
  if ((!args.file && !args.updateFirmware && !args.expr) || (args.file && args.watchFile)) {
    if (args.ports.length != 1)
      throw new Error("Can only have one port when using terminal mode");
    getPortPath(args.ports[0], function(path) {
      terminal(path, tasksComplete);
    });
  } else {
    //closure for stepping through each port
    //and connect + upload (use timeout callback [iterate] for proceeding)
    (function (ports, connect) {
      this.ports = ports;
      this.idx = 0;
      this.connect = connect;
      this.iterate = function() {
        if (idx>=ports.length) tasksComplete();
        else getPortPath(ports[idx++], function(path) {
          connect(path,iterate);
        });
      };
      iterate();
    })(args.ports, connect);
  }
}

function main() {
  setupConfig(Espruino, function() {
    if (args.job==="") makeJobFile(Espruino.Config);
    if (args.ports.length == 0 && (args.outputJS || args.outputHEX)) {
      console.log("No port supplied, but output file listed - not connecting");
      args.nosend = true;
      sendCode(tasksComplete);
    } else if (args.ports.length == 0 || args.showDevices) {
      console.log("Searching for serial ports...");
      var timeout = 5;
      var allPorts = [];
      var outputHeader = false;
      Espruino.Core.Serial.getPorts(function cb(ports, shouldCallAgain) {
        var newPorts = ports.filter(port=> !allPorts.find(p=>p.path==port.path));
        allPorts = allPorts.concat(newPorts);
        // if we're explictly asked for ports, output them
        // else just write it only if verbose
        if (newPorts.length) {
          if (args.showDevices) {
            if (!outputHeader) {
              log("PORTS:");
              outputHeader = true;
            }
            newPorts.forEach(p=>
              log(`  ${p.path}  (${p.description})${p.rssi?` RSSI ${p.rssi}`:""}`));
          } else {
            newPorts.forEach(p=>
              console.log("NEW PORT: "+p.path + " ("+p.description+")"));
          }
        }

        if (!args.showDevices && allPorts.length) {
          if (!args.nosend) log("Using first port, "+JSON.stringify(allPorts[0]));
          args.ports = [{type:"path",name:allPorts[0].path}];
          startConnect();
        } else if (timeout-- > 0 && shouldCallAgain) {
          // try again - sometimes BLE devices take a while
          setTimeout(function() {
            Espruino.Core.Serial.getPorts(cb);
          }, 500);
        } else {
          if (allPorts.length==0) {
            console.error("Error: No Ports Found");
            process.exit(1);
          } else {
            process.exit(0);
          }
        }
      });
    } else startConnect();
  });
}

// Start up
require('../index.js').init(main);
