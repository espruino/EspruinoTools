require('es6-shim');
/* Entrypoint for node module. Not used for Web IDE */
var fs = require("fs");

var espruinoInitialised = false;
var logger;
var defaultOptions = {
  logLevel: 3
};
var storedOptions = Object.assign({}, defaultOptions);

/* load all files in EspruinoTools... we do this so we can still
use these files normally in the Web IDE */
function loadJS(filePath) {
  logger.debug("Found "+filePath);
  var contents = fs.readFileSync(filePath, {encoding:"utf8"});
  var realExports = exports;
  exports = undefined;
  var r = eval(contents);
  exports = realExports; // utf8 lib somehow breaks this
  return r;
  /* the code below would be better, but it doesn't seem to work when running
   CLI - works fine when running as a module. */
  //return require("vm").runInThisContext(contents, filePath );
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

function createLogger(logLevel) {
  var getFunc = function getFunc(type, method) {
    var shouldLog = function() {
      if (!logLevel && logLevel !== 0) {
        logLevel = defaultOptions.logLevel;
      }
      if (logLevel >= 0 && type === 'error') return true;
      if (logLevel >= 1 && type === 'log') return true;
      if (logLevel >= 2 && type === 'warn') return true;
      if (logLevel >= 3 && type === 'debug') return true;
      return false;
    };
    return function () {
      if (shouldLog()) {
        console[method || type].apply(console, arguments);
      }
    };
  };
  return {
    error: getFunc('error'),
    log: getFunc('log'),
    warn: getFunc('warn'),
    debug: getFunc('debug', 'log')
  };
};

function handleInitArguments(arg1, arg2) {
  var callback;
  var opts;
  if (typeof arg1 === 'function') {
    callback = arg1;
  } else if (typeof arg2 === 'function') {
    callback = arg2;
  }
  if (typeof arg1 === 'object') {
    opts = arg1;
  } else if (espruinoInitialised) {
    opts = storedOptions;
  }
  storedOptions = Object.assign({}, defaultOptions, storedOptions, opts);
  return {
    callback: callback,
    options: storedOptions
  };
};

function init(options, callback) {
  var handled = handleInitArguments(options, callback);
  options = handled.options;
  callback = handled.callback;
  logger = logger || createLogger(options.logLevel);

  if (espruinoInitialised) {
    logger.debug("Already initialised.");
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

  try {
    global.acorn = require("acorn");
    acorn.walk = require("acorn/util/walk"); // FIXME - Package subpath './util/walk' is not defined by "exports" in latest 
  } catch(e) {
    logger.warn("Acorn library not found - you'll need it for compiled code");
  }

  // Load each JS file...
  // libraries needed by the tools
  loadDir(__dirname+"/libs");
  loadDir(__dirname+"/libs/esprima");
  // the 'main' file
  Espruino = loadJS(__dirname+"/espruino.js");
  // Core features
  loadDir(__dirname+"/core");
  // Various plugins
  loadDir(__dirname+"/plugins");

  // Bodge up notifications
  Espruino.Core.Notifications = {
    success : function(e) { logger.debug(e); },
    error : function(e) { logger.error(e); },
    warning : function(e) { logger.warn(e); },
    info : function(e) { logger.debug(e); },
  };
  Espruino.Core.Status = {
    setStatus : function(e,len) { logger.debug(e); },
    hasProgress : function() { return false; },
    incrementProgress : function(amt) {}
  };

  // Finally init everything
  jqReady.forEach(function(cb){cb();});
  Espruino.init();
  callback();
};

/** Initialise EspruinoTools and call the callback.
 When the callback is called, the global variable 'Espruino'
 will then contain everything that's needed to use EspruinoTools */
exports.init = init;

/** Send a file to an Espruino on the given port, call the callback when done */
exports.sendFile = function(port, filename, callback) {
  var code = fs.readFileSync(filename, {encoding:"utf8"});
  sendCode(port, code, callback);
};

exports.sendCode = sendCode;

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
        logger.error("Unable to connect!");
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
};

/** Execute an expression on Espruino, call the callback with the result */
exports.expr = function(port, expr, callback) {
  var exprResult = undefined;
  init(function() {
    Espruino.Core.Serial.startListening(function(data) { });
    Espruino.Core.Serial.open(port, function(status) {
      if (status === undefined) {
        logger.error("Unable to connect!");
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

/** Execute a statement on Espruino, call the callback with what is printed to the console */
exports.statement = function(port, expr, callback) {
  var exprResult = undefined;
  init(function() {
    Espruino.Core.Serial.startListening(function(data) { });
    Espruino.Core.Serial.open(port, function(status) {
      if (status === undefined) {
        logger.error("Unable to connect!");
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
};

/** Flash the given firmware file to an Espruino board. */
exports.flash = function(port, filename, flashOffset, callback) {
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
        logger.error("Unable to connect!");
        return callback();
      }
      var bin = fs.readFileSync(filename, {encoding:"binary"});
      Espruino.Core.Flasher.flashBinaryToDevice(bin, flashOffset, function(err) {
        logger[err ? 'error' : 'log'](err ? "Error!" : "Success!");
        setTimeout(function () {
          Espruino.Core.Serial.close();
        }, 500);
      });
    }, function() { // disconnected
      if (callback) callback();
    });
  });
};
