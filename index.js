require('es6-shim');
/* Entrypoint for node module. Not used for Web IDE */
var fs = require("fs");

/* load all files in EspruinoTools... we do this so we can still
use these files normally in the Web IDE */
function loadJS(filePath) {
  console.log("Found "+filePath);
  var contents = fs.readFileSync(filePath, {encoding:"utf8"});
  return eval(contents);
  /* the code below would be better, but it doesn't seem to work when running
   CLI - works fine when running as a module. */ 
  //return require("vm").runInThisContext(contents, filePath );
}
function loadDir(dir) {
  var files = fs.readdirSync(dir);
  for (var i in files) {
    var filePath = dir+"/"+files[i];
    if (files[i].substr(-3)==".js")
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
global.$ = function() { return jqShim; };

// ---------------

var espruinoInitialised = false;

function init(callback) {
  if (espruinoInitialised) {
    console.log("Already initialised.");
    return callback();
  }
  espruinoInitialised = true;

  global.navigator = { userAgent : "node" };
  global.document = {};  
  global.document = undefined;
  global.Espruino = undefined;

  try {
    global.acorn = require("acorn");
    acorn.walk = require("acorn/util/walk");
  } catch(e) {
    console.log("Acorn library not found - you'll need it for compiled code");
  }
  try {
    global.esprima = require("esprima");
  } catch(e) {
    console.log("esprima library not found - you'll need it to minify code");
  }
  try {
    global.esmangle = require("esmangle");
  } catch(e) {
    console.log("esmangle library not found - you'll need it to minify code");
  }
  try {
    global.escodegen = require("escodegen");
  } catch(e) {
    console.log("escodegen library not found - you'll need it to minify code");
  }
  
  // Load each JS file...
  // libraries needed by the tools
  loadDir(__dirname+"/libs");
  /* NOTE: we have libs/esprima that we're not parsing here.
   it's got some detection for node.js and loading this way 
   doesn't work - instead we require it using NPM below. */
  // the 'main' file
  Espruino = loadJS(__dirname+"/espruino.js");
  // Core features
  loadDir(__dirname+"/core");
  // Various plugins
  loadDir(__dirname+"/plugins");

  // Bodge up notifications
  Espruino.Core.Notifications = {
    success : function(e) { log(e); },
    error : function(e) { console.error(e); },
    warning : function(e) { console.warn(e); },
    info : function(e) { console.log(e); }, 
  };
  
  // Finally init everything
  jqReady.forEach(function(cb){cb();});
  callback();
};

/** Initialise EspruinoTools and call the callback.
 When the callback is called, the global variable 'Espruino'
 will then contain everything that's needed to use EspruinoTools */
exports.init = init;

/** Send a file to an Espruino on the given port, call the callback when done */
exports.sendFile = function(port, filename, callback) {
  var code = fs.readFileSync(filename, {encoding:"utf8"});
  init(function() {
    Espruino.Core.Serial.startListening(function(data) { });
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
      if (callback) callback();
    });
  });
};

/** Execute an expression on Espruino, call the callback with the result */
exports.expr = function(port, expr, callback) {
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
};


/** Flash the given firmware file to an Espruino board. */
exports.flash = function(port, filename, callback) {
  var code = fs.readFileSync(filename, {encoding:"utf8"});
  init(function() {
    Espruino.Core.Serial.startListening(function(data) { });
    Espruino.Core.Serial.open(port, function(status) {
      if (status === undefined) {
        console.error("Unable to connect!");
        return callback();
      }
      Espruino.Core.Flasher.flashBinaryToDevice(fs.readFileSync(filename, {encoding:"binary"}), function(err) {
        console.log(err ? "Error!" : "Success!");
        setTimeout(function() {
          Espruino.Core.Serial.close();
        }, 500);
      });
    }, function() { // disconnected
      if (callback) callback();
    });
  });
};
