#!/usr/bin/env node
/* Entrypoint for node module command-line app. Not used for Web IDE */
var fs = require("fs");

//override default console.log
var log = console.log;
console.log = function() {
 if (args.verbose)
   log.apply(console, arguments);
}
//Parse Arguments
var args = {
 ports: []
};

var isNextValidPort = function(next) {
 return next && next.indexOf("-") == -1 && next.indexOf(".js") == -1;
}
var isNextValidJS = function(next) {
 return next && next.indexOf("-") == -1 && next.indexOf(".js") >= 0;
}
var isNextValid = function(next) {
 return next && next.indexOf("-") == -1;
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
   else if (arg=="--no-ble") args.noBle = true;
   else if (arg=="--list") args.showDevices = true;
   else if (arg=="-p" || arg=="--port") {
     args.ports.push(next);
     var j = (++i) + 1;
     while (isNextValidPort(process.argv[j])) {
       args.ports.push(process.argv[j++]);
       i++;
     }
     if (!isNextValidPort(next)) throw new Error("Expecting a port argument to -p, --port");
   } else if (arg=="-e") {
     i++; args.expr = next;
     if (!isNextValid(next)) throw new Error("Expecting an expression argument to -e");
   } else if (arg=="-b") {
     i++; args.baudRate = parseInt(next);
     if (!isNextValid(next) || isNaN(args.baudRate)) throw new Error("Expecting a numeric argument to -b");
   } else if (arg=="-o") {
     i++; args.outputJS = next;
     if (!isNextValidJS(next)) throw new Error("Expecting a JS filename argument to -o");
   } else if (arg=="-f") {
     i++; var arg = next;
     if (!isNextValid(next)) throw new Error("Expecting a filename argument to -f");
     arg = arg.split(':', 2);
     args.updateFirmware = arg[0];
     args.firmwareFlashOffset = parseInt(arg[1] || '0');
     if (isNaN(args.firmwareFlashOffset)) throw new Error("Expecting a numeric offset for -f");
   } else throw new Error("Unknown Argument '"+arg+"', try --help");
 } else {
   if ("file" in args)
     throw new Error("File already specified as '"+args.file+"'");
   args.file = arg;
 }
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
function setupConfig(Espruino) {
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
 ["USAGE: espruino ...options... [file_to_upload.js]",
  "",
  "  -h,--help               : Show this message",
  "  -v,--verbose            : Verbose",
  "  -q,--quiet              : Quiet - apart from Espruino output",
  "  -m,--minify             : Minify the code before sending it",
  "  -w,--watch              : If uploading a JS file, continue to watch it for",
  "                            changes and upload again if it does.",
  "  -p,--port /dev/ttyX     : Specify port(s) to connect to",
  "  -b baudRate             : Set the baud rate of the serial connection",
  "                              No effect when using USB, default: 9600",
  "  --no-ble                : Disables Bluetooth Low Energy (using the 'bleat' module)",
  "  --list                  : List all available devices and exit",
  "  -t,--time               : Set Espruino's time when uploading code",
  "  -o out.js               : Write the actual JS code sent to Espruino to a file",
  "  -f firmware.bin[:N]     : Update Espruino's firmware to the given file",
  "                              Espruino must be in bootloader mode.",
  "                              Optionally skip N first bytes of the bin file.",
  "  -e command              : Evaluate the given expression on Espruino",
  "                              If no file to upload is specified but you use -e,",
  "                              Espruino will not be reset",
  "",
  "If no file, command, or firmware update is specified, this will act",
  "as a terminal for communicating directly with Espruino. Press Ctrl-C",
  "twice to exit.",
  "",
  "Please report bugs via https://github.com/espruino/EspruinoTool/issues",
  ""].
   forEach(function(l) {log(l);});
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
    Espruino.callProcessor("transformForEspruino", code, function(code) {
      if (args.outputJS) {
        log("Writing output to "+args.outputJS);
        require("fs").writeFileSync(args.outputJS, code);
      }
      Espruino.Core.CodeWriter.writeToEspruino(code, callback);
    });
  } else {
    callback();
  }
}

/* Connect and send file/expression/etc */
function connect(port, exitCallback) {
  if (!args.quiet) log("Connecting to '"+port+"'");
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
  Espruino.Core.Serial.open(port, function(status) {
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
}

/* Connect and enter terminal mode */
function terminal(port, exitCallback) {
  if (!args.quiet) log("Connecting to '"+port+"'");
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
  Espruino.Core.Serial.open(port, function(status) {
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
      if (args.watchFile) {
        var busy = false;
        require("fs").watch(args.file, { persistent : false,}, function(eventType) {
          if (busy || eventType!='change') return;
          busy = true;
          console.log(args.file+" changed, reloading");
          sendCode(function() {
            console.log("Done!");
            busy = false;
          });
        });
      }
    });

   }, function() {
     log("\nDisconnected.");
     exitCallback();
   });
}

function startConnect() {
  if ((!args.file && !args.updateFirmware && !args.expr) || (args.file && args.watchFile)) {
    if (args.ports.length != 1)
      throw new Error("Can only have one port when using terminal mode");
    terminal(args.ports[0], function() { process.exit(0); });
  } else {
    //closure for stepping through each port
    //and connect + upload (use timeout callback [iterate] for proceeding)
    (function (ports, connect) {
      this.ports = ports;
      this.idx = 0;
      this.connect = connect;
      this.iterate = function() {
        (idx>=ports.length?process.exit(0):connect(ports[idx++],iterate));
      }
      iterate();
    })(args.ports, connect);
  }
}

function main() {
  setupConfig(Espruino);
  if (args.ports.length == 0 || args.showDevices) {
    console.log("Searching for serial ports...");
    Espruino.Core.Serial.getPorts(function(ports) {
      // If we've been asked to list all devices, do it and exit
      if (args.showDevices) {
        log("PORTS:\n  "+ports.map(function(p) {
          if (p.description) return p.path + " ("+p.description+")";
          return p.path;
        }).join("\n  "));
        process.exit(0);
        return;
      }
      console.log("PORTS:\n  "+ports.map(function(p) {
        if (p.description) return p.path + " ("+p.description+")";
        return p.path;
      }).join("\n  "));
      if (ports.length>0) {
        log("Using first port, "+JSON.stringify(ports[0]));
        args.ports = [ports[0].path];
        startConnect();
      } else
        throw new Error("No Ports Found");
    });
  } else startConnect();
}

// Start up
require('../index.js').init(main);
