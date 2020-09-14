/**
 Copyright 2014 Gordon Williams (gw@pur3.co.uk)

 This Source Code is subject to the terms of the Mozilla Public
 License, v2.0. If a copy of the MPL was not distributed with this
 file, You can obtain one at http://mozilla.org/MPL/2.0/.

 ------------------------------------------------------------------
  Automatically minify code before it is sent to Espruino
 ------------------------------------------------------------------
**/
"use strict";
(function(){

  var minifyUrl = "https://closure-compiler.appspot.com/compile";
  var minifyCache = [];

  function init() {
    Espruino.Core.Config.addSection("Minification", {
      sortOrder:600,
      description: "Minification takes your JavaScript code and makes it smaller by removing comments and whitespace. "+
                   "It can make your code execute faster and will save memory, but it will also make it harder to debug.\n"+
                   "Esprima is a minifier built in to the Web IDE, so it can be used without an internet connection. "+
                   "The Closure Compiler is an online service offered by Google. It produces more efficient code, but you need an internet connection to use it."
    });

    Espruino.Core.Config.add("MINIFICATION_LEVEL", {
      section : "Minification",
      name : "Minification",
      description : "Automatically minify code from the Editor window?",
      type : { "":"No Minification",
               "ESPRIMA":"Esprima (offline)",
               "WHITESPACE_ONLY":"Closure (online) - Whitespace Only",
               "SIMPLE_OPTIMIZATIONS":"Closure (online) - Simple Optimizations",
               "ADVANCED_OPTIMIZATIONS":"Closure (online) - Advanced Optimizations (not recommended)"},
      defaultValue : ""
    });
    Espruino.Core.Config.add("MODULE_MINIFICATION_LEVEL", {
      section : "Minification",
      name : "Module Minification",
      description : "Automatically minify modules? Only modules with a .js extension will be minified - if a file with a .min.js extension exists then it will be used instead.",
      type : { "":"No Minification",
               "ESPRIMA":"Esprima (offline)",
               "WHITESPACE_ONLY":"Closure (online) - Whitespace Only",
               "SIMPLE_OPTIMIZATIONS":"Closure (online) - Simple Optimizations",
               "ADVANCED_OPTIMIZATIONS":"Closure (online) - Advanced Optimizations (not recommended)"},
      defaultValue : "ESPRIMA"
    });

    Espruino.Core.Config.add("MINIFICATION_Mangle",{
      section : "Minification",
      name : "Esprima: Mangle",
      description : "Shorten variable names",
      type : "boolean",
      defaultValue : true
    });

    // When code is sent to Espruino, search it for modules and add extra code required to load them
    Espruino.addProcessor("transformForEspruino", function(code, callback) {
      minify(code, callback, Espruino.Config.MINIFICATION_LEVEL, false, "");
    });
   // When code is sent to Espruino, search it for modules and add extra code required to load them
    Espruino.addProcessor("transformModuleForEspruino", function(module, callback) {
      minify(module.code, function(code) {
        module.code = code;
        callback(module);
      }, Espruino.Config.MODULE_MINIFICATION_LEVEL, true, " in "+module.name);
    });
  }


  // Use the 'offline' Esprima compile
  function minifyCodeEsprima(code,callback,description) {
    if ((typeof esprima == "undefined") ||
        (typeof esmangle == "undefined") ||
        (typeof escodegen == "undefined")) {
      console.warn("esprima/esmangle/escodegen not defined - not minifying")
      return callback(code);
    }

    var code, syntax, option, str, before, after;
    var options = {};
    options["mangle"] = Espruino.Config.MINIFICATION_Mangle;
    option = {format: {
      renumber: true,
      hexadecimal: true,
      escapeless: false,
      indent: {style: ''},
      quotes: 'auto',
      compact: true,
      semicolons: false,
      parentheses: false
    }};
    str = '';
    try {
        before = code.length;
        syntax = esprima.parse(code, { raw: true, loc: true });
        syntax = obfuscate(syntax,options);
        code = escodegen.generate(syntax, option);
        after = code.length;
        if (before > after) {
          Espruino.Core.Notifications.info('No errors'+description+'. Minified ' + before + ' bytes to ' + after + ' bytes.');
        } else {
          Espruino.Core.Notifications.info('Can not minify further'+description+', code is already optimized.');
        }
        callback(code);
    } catch (e) {
      Espruino.Core.Notifications.error(e.toString()+description);
      console.error(e.stack);
      callback(code);
    } finally { }
  }
  function obfuscate(syntax,options) {
    // hack for random changes between version we have included for Web IDE and node.js version
    if (typeof esmangle.require == "undefined")
      esmangle.require = esmangle.pass.require;
    syntax = esmangle.optimize(syntax, null,{
        destructive: true,
        directive: true,
        preserveCompletionValue: false,
        legacy: false,
        topLevelContext: false,
        inStrictCode: false
    });
    if (options.mangle) syntax = esmangle.mangle(syntax);
    return syntax;
  }

  // Use the 'online' Closure compiler
  function minifyCodeGoogle(code, callback, minificationLevel, description){
    for (var i in minifyCache) {
      var item = minifyCache[i];
      if (item.code==code && item.level==minificationLevel) {
        console.log("Found code in minification cache - using that"+description);
        // move to front of cache
        minifyCache.splice(i,1); // remove old
        minifyCache.push(item); // add at front
        // callback
        callback(item.minified);
        return;
      }
    }
    closureCompilerGoogle(code,  minificationLevel, 'compiled_code', function(minified) {
      if (minified.trim()!="") {
        Espruino.Core.Notifications.info('No errors'+description+'. Minifying ' + code.length + ' bytes to ' + minified.length + ' bytes');
        if (minifyCache.length>100)
          minifyCache = minifyCache.slice(-100);
        minifyCache.push({ level : minificationLevel, code : code, minified : minified });
        callback(minified);
      } else {
        Espruino.Core.Notifications.warning("Errors while minifying"+description+" - sending unminified code.");
        callback(code);
        // get errors...
        closureCompilerGoogle(code,  minificationLevel, 'errors',function(errors) {
          errors.split("\n").forEach(function (err) {
            if (err.trim()!="")
              Espruino.Core.Notifications.error(err.trim()+description);
          });
        });
      }
    });
  }
  function closureCompilerGoogle(code, minificationLevel, output_info, callback){
    if(minificationLevel !== ""){
      var minifyObj = $.param({
        compilation_level: minificationLevel,
        output_format: "text",
        output_info: output_info,
        js_code: code,
        language : "ECMASCRIPT6", // so no need to mess with binary numbers now. \o/
        language_out : "ECMASCRIPT5" // ES6 output uses some now features now that Espruino doesn't like
      });
      $.post(minifyUrl, minifyObj, function(minifiedCode) {
        code = minifiedCode;
      },"text")
      .error(function() {
        Espruino.Core.Notifications.error("HTTP error while minifying");
      })
      .complete(function() {
        // ensure we call the callback even if minification failes
        callback(code);
      });
    }
  }

  function minify(code, callback, level, isModule, description) {
    (function() {
      Espruino.Core.Status.setStatus("Minifying"+(isModule?description.substr(2):""));
      var _callback = callback;
      callback = function(code) {
        Espruino.Core.Status.setStatus("Minification complete");
        _callback(code);
      };
    })();
    var minifyCode = code;
    var minifyCallback = callback;
    if (isModule) {
      /* if we're a module, we wrap this in a function so that unused constants
      and functions can be removed */
      var header = "(function(){";
      var footer = "})();";
      minifyCode = header+code+footer;
      minifyCallback = function (minified){
        callback(minified.substr(header.length, minified.length-(header.length+footer.length+1)));
      }
    }

    switch(level){
      case "WHITESPACE_ONLY":
      case "SIMPLE_OPTIMIZATIONS":
      case "ADVANCED_OPTIMIZATIONS": minifyCodeGoogle(code, callback, level, description); break;
      case "ESPRIMA": minifyCodeEsprima(code, callback, description); break;
      default: callback(code); break;
    }
  }

  Espruino.Plugins.Minify = {
    init : init,
  };
}());
