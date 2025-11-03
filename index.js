require('es6-shim');
/* Entrypoint for node module. Not used for Web IDE */
const fs = require("fs");
const vm = require('vm');

/* load all files in EspruinoTools... we do this so we can still
use these files normally in the Web IDE */
function loadJS(filePath) {
  console.log("Found "+filePath);
  var contents = fs.readFileSync(filePath, {encoding:"utf8"});
  var realExports = exports;
  exports = undefined;
  const script = new vm.Script(contents, {
    filename: filePath, // This preserves the filename in the stack trace
    displayErrors: true,
  });
  try {
    script.runInThisContext();
  } catch (e) {
    console.log("ERROR "+e+" while loading "+filePath);
  }
  exports = realExports; // utf8 lib somehow breaks this
}
function loadDir(dir) {
  var files = fs.readdirSync(dir);
  for (var i in files) {
    var filePath = dir+"/"+files[i];
    if (files[i].substr(-3)==".js" && files[i][0]!="_")
      loadJS(filePath);
    /*else if (fs.lstatSync(filePath).isDirectory())
      loadDir(filePath); // recursive */
  }
}

// ---------------
// Horrible jQuery stubs. We don't want to pull in jQuery itself because it drags in a million other
// modules that we don't care about, and needs jsDom which has nasty dependency problems
// ---------------
var jqReady = [];
var jqShim = {
  ready : function(cb) { jqReady.push(cb); },
  css : function() {},
  html : function() {},
  width : function() {},
  height : function() {},
  addClass : function() {},
  removeClass : function() {},
  appendTo : function() { return jqShim; },
  show : function() {},
  hide : function() {},
};
// ---------------

var espruinoInitialised = false;

/**
 * init Espruino global vars
 * @param {() => void} callback
 */
function init(callback) {
  if (espruinoInitialised) {
    console.log("Already initialised.");
    return callback();
  }
  espruinoInitialised = true;

  if (global.$ === undefined)
    global.$ = function() { return jqShim; };
  if (global.navigator === undefined)
    global.navigator = { userAgent : "node" };
  if (global.document === undefined) {
    global.document = {};
    global.document = undefined;
  }
  global.Espruino = undefined;
  global.require = require

  try {
    global.acorn = require("acorn");
    acorn.walk = require("acorn/util/walk"); // FIXME - Package subpath './util/walk' is not defined by "exports" in latest
  } catch(e) {
    console.log("Acorn library not found - you'll need it for compiled code");
  }

  // Load each JS file...
  // libraries needed by the tools
  loadDir(__dirname+"/libs");
  loadDir(__dirname+"/libs/esprima");
  // the 'main' file
  loadJS(__dirname+"/espruino.js");
  // Core features
  loadDir(__dirname+"/core");
  // Various plugins
  loadDir(__dirname+"/plugins");

  // Bodge up notifications
  Espruino.Core.Notifications = {
    success : function(e) { console.log(e); },
    error : function(e) { console.error(e); },
    warning : function(e) { console.warn(e); },
    info : function(e) { console.log(e); },
  };
  Espruino.Core.Status = {
    setStatus : function(e,len) { console.log(e); },
    hasProgress : function() { return false; },
    incrementProgress : function(amt) {}
  };

  // Finally init everything
  jqReady.forEach(function(cb){cb();});
  Espruino.init();
  callback();
}

/** Initialise EspruinoTools and call the callback.
 When the callback is called, the global variable 'Espruino'
 will then contain everything that's needed to use EspruinoTools */
exports.init = init;

/**
 * Send a file to an Espruino on the given port, call the callback when done
 * @param {string} port
 * @param {string} filename
 * @param {() => void} callback
 */
function sendFile(port, filename, callback) {
  var code = fs.readFileSync(filename, {encoding:"utf8"});
  sendCode(port, code, callback);
}
exports.sendFile = sendFile;

/**
 * Send code to Espruino
 * @param {string} port
 * @param {string} code
 * @param {() => void} callback
*/
function sendCode(port, code, callback) {
  var response = "";
  init(function() {
    Espruino.Core.Serial.startListening(function(data) {
      data = new Uint8Array(data);
      for (var i=0;i<data.length;i++)
        response += String.fromCharCode(data[i]);
    });
    Espruino.Core.Serial.open(port, function(status) {
      if (status === undefined) {
        console.error("Unable to connect!");
        return callback();
      }
      Espruino.callProcessor("transformForEspruino", code, function(code) {
        Espruino.Core.CodeWriter.writeToEspruino(code, function() {
          setTimeout(function() {
            Espruino.Core.Serial.close();
          }, 500);
        });
      });
    }, function() { // disconnected
      if (callback)
        callback(response);
    });
  });
}
exports.sendCode = sendCode;

/**
 * Execute an expression on Espruino, call the callback with the result
 * @param {string} port
 * @param {string} expr
 * @param {(result: string) => void} callback
 */
function expr(port, expr, callback) {
  var exprResult = undefined;
  init(function() {
    Espruino.Core.Serial.startListening(function(data) { });
    Espruino.Core.Serial.open(port, function(status) {
      if (status === undefined) {
        console.error("Unable to connect!");
        return callback();
      }
      Espruino.Core.Utils.executeExpression(expr, function(result) {
        setTimeout(function() {
          Espruino.Core.Serial.close();
        }, 500);
        exprResult = result;
      });
    }, function() { // disconnected
      if (callback) callback(exprResult);
    });
  });
}
exports.expr = expr;

/**
 * Execute a statement on Espruino, call the callback with what is printed to the console
 * @param {string} port
 * @param {string} expr
 * @param {(result: string) => void} callback
 */
function statement(port, expr, callback) {
  var exprResult = undefined;
  init(function() {
    Espruino.Core.Serial.startListening(function(data) { });
    Espruino.Core.Serial.open(port, function(status) {
      if (status === undefined) {
        console.error("Unable to connect!");
        return callback();
      }
      Espruino.Core.Utils.executeStatement(expr, function(result) {
        setTimeout(function() {
          Espruino.Core.Serial.close();
        }, 500);
        exprResult = result;
      });
    }, function() { // disconnected
      if (callback) callback(exprResult);
    });
  });
}
exports.statement = statement;

/**
 * Flash the given firmware file to an Espruino board.
 * @param {string} port
 * @param {string} filename
 * @param {number} flashOffset
 * @param {() => void} callback
 */
function flash(port, filename, flashOffset, callback) {
  if (typeof flashOffset === 'function') {
    // backward compatibility if flashOffset is missed
    callback = flashOffset;
    flashOffset = null;
  }

  var code = fs.readFileSync(filename, {encoding:"utf8"});
  init(function() {
    Espruino.Core.Serial.startListening(function(data) { });
    Espruino.Core.Serial.open(port, function(status) {
      if (status === undefined) {
        console.error("Unable to connect!");
        return callback();
      }
      var bin = fs.readFileSync(filename, {encoding:"binary"});
      Espruino.Core.Flasher.flashBinaryToDevice(bin, flashOffset, function(err) {
        console.log(err ? "Error!" : "Success!");
        setTimeout(function() {
          Espruino.Core.Serial.close();
        }, 500);
      });
    }, function() { // disconnected
      if (callback) callback();
    });
  });
}
exports.flash = flash;
