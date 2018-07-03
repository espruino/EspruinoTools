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
   "  -w,--watch               : If uploading a JS file, continue to watch it for",
   "                               changes and upload again if it does.",
   "  -p,--port /dev/ttyX",
   "  -p,--port aa:bb:cc:dd:ee : Specify port(s) or device addresses to connect to",
   "  -d deviceName            : Connect to the first device with a name containing deviceName",
   "  -b baudRate              : Set the baud rate of the serial connection",
   "                               No effect when using USB, default: 9600",
   "  --no-ble                 : Disables Bluetooth Low Energy (using the 'noble' module)",
   "  --list                   : List all available devices and exit",
   "  --listconfigs            : Show all available config options and exit",
   "  --config key=value       : Set internal Espruino config option",
   "  -t,--time                : Set Espruino's time when uploading code",
   "  -o out.js                : Write the actual JS code sent to Espruino to a file",
   "  -ohex out.hex            : Write the JS code to a hex file as if sent by E.setBootCode",
   "  -n                       : Do not connect to Espruino to upload code",
   "  --board BRDNAME/BRD.json : Rather than checking on connect, use the given board name or file",
   "  -f firmware.bin[:N]      : Update Espruino's firmware to the given file",
   "                               Espruino must be in bootloader mode.",
   "                               Optionally skip N first bytes of the bin file.",
   "  -e command               : Evaluate the given expression on Espruino",
   "                               If no file to upload is specified but you use -e,",
   "                               Espruino will not be reset",
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
 ports: [],
 config: {}
};

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
   } else if (arg=="-ohex") {
     i++; args.outputHEX = next;
     if (!isNextValidHEX(next)) throw new Error("Expecting a .hex file argument to -ohex");
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
   log("-ohex used - enabling MODULE_AS_FUNCTION");
   Espruino.Config.MODULE_AS_FUNCTION = true;
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
   Espruino.Config.ENV_ON_CONNECT = false;
   var env = Espruino.Core.Env.getData();
   env.BOARD = args.board;
   if (args.board.indexOf(".")>=0) {
     var data = JSON.parse(require("fs").readFileSync(args.board).toString());
     for (var key in data)
       env[key] = data[key];
     Espruino.callProcessor("boardJSONLoaded", env, function() {
       console.log("Manual board JSON load complete");
       callback();
     });
   } else { // download the JSON
     Espruino.Plugins.BoardJSON.loadJSON(env, Espruino.Config.BOARD_JSON_URL+"/"+env.BOARD+".json", function() {
       console.log("Manual board JSON load complete");
       callback();
     });
   }
 } else callback();
}

/* Write a file into a Uint8Array in the form that Espruino expects. Return the
address of the next file.
NOTE: On platforms with only a 64 bit write (STM32L4) this won't work */
function setBufferFile(buffer, addr, filename, data) {
  if (!typeof data=="string") throw "Expecting string";
  if (addr&3) throw "Unaligned";
  var fileSize = data.length;
  var nextAddr = addr+16+((fileSize+3)&~3);
  if (nextAddr>buffer.length) throw "File too big for buffer";
  // https://github.com/espruino/Espruino/blob/master/src/jsflash.h#L30
  // 'size'
  buffer.set([fileSize&255, (fileSize>>8)&255,
              (fileSize>>16)&255, (fileSize>>24)&255], addr);
  // 'replacement' - none, since this is the only file
  buffer.set([0xFF,0xFF,0xFF,0xFF], addr+4);
  // 'filename', 8 bytes
  buffer.set([0,0,0,0,0,0,0,0], addr+8);
  for (var i=0;i<filename.length;i++)
    buffer[addr+8+i] = filename.charCodeAt(i);
  // Write the data in
  for (var i=0;i<fileSize;i++)
    buffer[16+i] = data.charCodeAt(i);
  // return next addr
  return nextAddr;
}

// convert the given code to intel hex at the given location
function toIntelHex(code) {
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
  setBufferFile(buffer, 0, ".bootcde", code);
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
  if (code) {
    var env = Espruino.Core.Env.getData();
    if (!env.info || !env.info.builtin_modules) {
      log("********************************************************************");
      log("* No list of built-in modules found. If you get 'Module not found' *");
      log("* messages for built-in modules you may want to connect to a board *");
      log("* with '-p devicePath' or use '--board BOARDNAME'                  *");
      log("********************************************************************");
    }
    Espruino.callProcessor("transformForEspruino", code, function(code) {
      if (args.outputJS) {
        log("Writing output to "+args.outputJS);
        require("fs").writeFileSync(args.outputJS, code);
      }
      if (args.outputHEX) {
        log("Writing hex output to "+args.outputHEX);
        require("fs").writeFileSync(args.outputHEX, toIntelHex(code));
      }
      if (!args.nosend)
        Espruino.Core.CodeWriter.writeToEspruino(code, callback);
      else
        callback();
    });
  } else {
    callback();
  }
}

/* Connect and send file/expression/etc */
function connect(devicePath, exitCallback) {
  if (!args.quiet) if (! args.nosend) log("Connecting to '"+devicePath+"'");
  var currentLine = "";
  var exitTimeout;
  Espruino.Core.Serial.startListening(function(data) {
   // convert ArrayBuffer to string
   data = String.fromCharCode.apply(null, new Uint8Array(data));
   // Now handle...
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
  if (! args.nosend) {
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
        // figure out what code we need to send (if any)
        sendCode(function() {
          exitTimeout = setTimeout(exitCallback, 500);
        });
      }
      // send code over here...

      // ----------------------
     }, function() {
       log("Disconnected.");
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
      });
      // start watching again
      sendOnFileChanged();
    }, 500);
  });
}

/* Connect and enter terminal mode */
function terminal(devicePath, exitCallback) {
  if (!args.quiet) log("Connecting to '"+devicePath+"'");
  var hadCtrlC = false;
  var hadCR = false;
  process.stdin.setRawMode(true);
  Espruino.Core.Serial.startListening(function(data) {
    data = new Uint8Array(data);
    process.stdout.write(String.fromCharCode.apply(null, data));
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
    process.stdin.on('readable', function() {
      var chunk = process.stdin.read();
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

    // figure out what code we need to send (if any)
    sendCode(function() {
      if (args.watchFile) sendOnFileChanged();
    });

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
    var timeout = 2;
    Espruino.Core.Serial.getPorts(function cb(ports, shouldCallAgain) {
      //log(JSON.stringify(ports,null,2));
      var found = ports.find(function(p) { return p.description && p.description.toLowerCase().indexOf(searchString)>=0; });
      if (found) {
        log("Found "+JSON.stringify(found.description)+" ("+JSON.stringify(found.path)+")");
        callback(found.path);
      } else {
        if (timeout-- > 0 && shouldCallAgain) // try again - sometimes BLE devices take a while
          Espruino.Core.Serial.getPorts(cb);
        else {
         log("Port named "+JSON.stringify(port.name)+" not found");
         process.exit(1);
       }
      }
    });
  } else throw new Error("Unknown port type! "+JSON.stringify(port));
}

function startConnect() {
  if ((!args.file && !args.updateFirmware && !args.expr) || (args.file && args.watchFile)) {
    if (args.ports.length != 1)
      throw new Error("Can only have one port when using terminal mode");

    getPortPath(args.ports[0], function(path) {
      terminal(path, function() { process.exit(0); });
    });
  } else {
    //closure for stepping through each port
    //and connect + upload (use timeout callback [iterate] for proceeding)
    (function (ports, connect) {
      this.ports = ports;
      this.idx = 0;
      this.connect = connect;
      this.iterate = function() {
        if (idx>=ports.length) process.exit(0);
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
      sendCode(function() {
        log("File written. Exiting.");
        process.exit(1);
      });
    } else if (args.ports.length == 0 || args.showDevices) {
      console.log("Searching for serial ports...");
      Espruino.Core.Serial.getPorts(function(ports, shouldCallAgain) {
        function gotPorts(ports) {
          log("PORTS:\n  "+ports.map(function(p) {
            if (p.description) return p.path + " ("+p.description+")";
            return p.path;
          }).join("\n  "));
          process.exit(0);
        }
        // If we've been asked to list all devices, do it and exit
        if (args.showDevices) {
          /* Note - we want to search again because some things
          like `noble` won't catch everything on the first try */
          if (shouldCallAgain) Espruino.Core.Serial.getPorts(gotPorts);
          else gotPorts(ports);
          return;
        }
        console.log("PORTS:\n  "+ports.map(function(p) {
          if (p.description) return p.path + " ("+p.description+")";
          return p.path;
        }).join("\n  "));
        if (ports.length>0) {
          if (! args.nosend) log("Using first port, "+JSON.stringify(ports[0]));
          args.ports = [{type:"path",name:ports[0].path}];
          startConnect();
        } else
          throw new Error("No Ports Found");
      });
    } else startConnect();
  });
}

// Start up
require('../index.js').init(main);
