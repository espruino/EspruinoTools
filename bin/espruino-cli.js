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
var isNextInvalid = function(next) {
 return !next || next.indexOf("-") !== -1 || next.indexOf(".js") !== -1;
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
   else if (arg=="-p" || arg=="--port") { 
     args.ports.push(next); 
     var j = (++i) + 1;
     while (!isNextInvalid(process.argv[j])) {
       args.ports.push(process.argv[j++]);
       i++;
     }
     if (isNextInvalid(next)) throw new Error("Expecting a port argument to -p, --port"); 
   } else if (arg=="-e") { 
     i++; args.expr = next; 
     if (isNextInvalid(next)) throw new Error("Expecting an expression argument to -e"); 
   } else if (arg=="-f") { 
     i++; args.updateFirmware = next; 
     if (isNextInvalid(next)) throw new Error("Expecting a filename argument to -f"); 
   } else throw new Error("Unknown Argument '"+arg+"', try --help");
 } else {
   if ("file" in args)
     throw new Error("File already specified as '"+args.file+"'");
   args.file = arg;
 }
}
//if nothing, show help and exit
if (process.argv.length==2) 
 args.help = true;
//Extra argument stuff
args.espruinoPrefix = args.quiet?"":"--]";
args.espruinoPostfix = "";
if (args.color) {
 args.espruinoPrefix = "\033[32m";
 args.espruinoPostfix = "\033[0m";
}
//this is called after Espruino tools are loaded, and
//sets up configuration as requested by the command-line options
function setupConfig(Espruino) {
 if (args.minify) Espruino.Config.MINIFICATION_LEVEL = "SIMPLE_OPTIMIZATIONS";
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
  "  -p,--port /dev/ttyX     : Specify port(s) to connect to",
  "  -f firmware.bin         : Update Espruino's firmware to the given file",
  "                              Espruino must be in bootloader mode",
  "  -e command              : Evaluate the given expression on Espruino",
  "                              If no file to upload is specified but you use -e,",
  "                              Espruino will not be reset", 
  "",
  "Please report bugs via https://github.com/espruino/EspruinoTool/issues",
  ""].
   forEach(function(l) {log(l);});  
 process.exit(1);
}

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
  Espruino.Core.Serial.open(port, function() {
    if (!args.quiet) log("Connected");
    // figure out what code we need to send
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
    // Do we need to update firmware?
    if (args.updateFirmware) {
      if (code) throw new Error("Can't update firmware *and* upload code right now.");
      Espruino.Core.Flasher.flashBinaryToDevice(fs.readFileSync(args.updateFirmware, {encoding:"binary"}), function(err) {
        log(err ? "Error!" : "Success!");
        exitTimeout = setTimeout(exitCallback, 500);
      });
    }
    // send code over here...
    if (code)
      Espruino.callProcessor("transformForEspruino", code, function(code) {
        Espruino.Core.CodeWriter.writeToEspruino(code, function() {
          exitTimeout = setTimeout(exitCallback, 500);
        }); 
      });
    //
    // ---------------------- 
   }, function() {
     log("Disconnected");
   });
}

function main() {
  setupConfig(Espruino);

  if (Espruino.Core.Serial === undefined) {
    console.error("No serial driver found");
    return;
  }
  if (args.ports.length > 0) {
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
  } else {    
    log("Searching for serial ports...");
    Espruino.Core.Serial.getPorts(function(ports) {
      console.log(ports);
      if (ports.length>0) 
        connect(ports[0], function() { process.exit(0); });
      else
        throw new Error("No Ports Found");        
    });
  }
}

// Start up
require('../index.js').init(main);
