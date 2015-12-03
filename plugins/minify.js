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
  
  var minifyUrl = "http://closure-compiler.appspot.com/compile";
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
      description : "Shorten variable name",
      type : "boolean",
      defaultValue : true
    });
    Espruino.Core.Config.add("MINIFICATION_Unreachable",{
      section : "Minification",
      name : "Esprima: Unreachable branches",
      description : "Remove unreachable branches",
      type : "boolean",
      defaultValue : true  
    });
    Espruino.Core.Config.add("MINIFICATION_Unused",{
      section : "Minification",
      name : "Esprima: Unused variables",
      description : "Remove unused variables",
      type : "boolean",
      defaultValue : true  
    });
    Espruino.Core.Config.add("MINIFICATION_Literal",{
      section : "Minification",
      name : "Esprima: Fold constants",
      description : "Fold (literal) constants",
      type : "boolean",
      defaultValue : true  
    });
    Espruino.Core.Config.add("MINIFICATION_DeadCode",{
      section : "Minification",
      name : "Esprima: Dead Code",
      description : "Eliminate dead code",
      type : "boolean",
      defaultValue : true  
    });

    // When code is sent to Espruino, search it for modules and add extra code required to load them 
    Espruino.addProcessor("transformForEspruino", function(code, callback) {
      minify(code, callback, Espruino.Config.MINIFICATION_LEVEL, false);
    });
   // When code is sent to Espruino, search it for modules and add extra code required to load them 
    Espruino.addProcessor("transformModuleForEspruino", function(code, callback) {
      minify(code, callback, Espruino.Config.MODULE_MINIFICATION_LEVEL, true);
    });
  }


  // Use the 'offline' Esprima compile
  function minifyCodeEsprima(code,callback) {
    if ((typeof esprima == "undefined") ||
        (typeof esmangle == "undefined") ||
        (typeof escodegen == "undefined")) {
      console.warn("esprima/esmangle/escodegen not defined - not minifying")
      return callback(code);
    }

    var code, syntax, option, str, before, after;
    var options = {};
    options["mangle"] = Espruino.Config.MINIFICATION_Mangle;
    options["remove-unreachable-branch"] = Espruino.Config.MINIFICATION_Unreachable;
    options["remove-unused-vars"] = Espruino.Config.MINIFICATION_Unused;
    options["fold-constant"] = Espruino.Config.MINIFICATION_Literal;
    options["eliminate-dead-code"] = Espruino.Config.MINIFICATION_DeadCode;
    option = {format: {indent: {style: ''},quotes: 'auto',compact: true}};
    str = '';
    try {
        before = code.length;
        syntax = esprima.parse(code, { raw: true, loc: true });
        syntax = obfuscate(syntax,options);
        code = escodegen.generate(syntax, option);
        after = code.length;
        if (before > after) {
          Espruino.Core.Notifications.info('No error. Minifying ' + before + ' bytes to ' + after + ' bytes.');
          callback(code);
        } else {
          Espruino.Core.Notifications.warning('Can not minify further, code is already optimized.');
        }
    } catch (e) {
      Espruino.Core.Notifications.error(e.toString());
      console.error(e.stack);
      callback(code);
    } finally { }
  }
  function obfuscate(syntax,options) {
    // hack for random changes between version we have included for Web IDE and node.js version
    if (typeof esmangle.require == "undefined")
      esmangle.require = esmangle.pass.require;
    var result = esmangle.optimize(syntax, createPipeline(options));
    if (options.mangle) { result = esmangle.mangle(result);}
    return result;
  }
  function createPipeline(options) {
    var passes, pipeline, inputs, i, el, optimizer;
    passes = {
      'eliminate-dead-code': 'pass/dead-code-elimination',
      'fold-constant': 'pass/tree-based-constant-folding',
      'remove-unreachable-branch': 'pass/remove-unreachable-branch',
      'remove-unused-vars': 'pass/drop-variable-definition'
    };
    pipeline = [
      'pass/hoist-variable-to-arguments',
      'pass/transform-dynamic-to-static-property-access',
      'pass/transform-dynamic-to-static-property-definition',
      'pass/transform-immediate-function-call',
      'pass/transform-logical-association',
      'pass/reordering-function-declarations',
      'pass/remove-unused-label',
      'pass/remove-empty-statement',
      'pass/remove-wasted-blocks',
      'pass/transform-to-compound-assignment',
      'pass/transform-to-sequence-expression',
      'pass/transform-branch-to-expression',
      'pass/transform-typeof-undefined',
      'pass/reduce-sequence-expression',
      'pass/reduce-branch-jump',
      'pass/reduce-multiple-if-statements',
      'pass/dead-code-elimination',
      'pass/remove-side-effect-free-expressions',
      'pass/remove-context-sensitive-expressions',
      'pass/tree-based-constant-folding',
      'pass/drop-variable-definition',
      'pass/remove-unreachable-branch'
    ];
    for(var i in passes){if(!options[i]){delete(passes[i])};}
    pipeline = pipeline.map(esmangle.require);
    pipeline = [pipeline];
    pipeline.push({
      once: true,
      pass: [
        'post/transform-static-to-dynamic-property-access',
        'post/transform-infinity',
        'post/rewrite-boolean',
        'post/rewrite-conditional-expression'
      ].map(esmangle.require)
    });
    return pipeline;
  }

  // Use the 'online' Closure compiler
  function minifyCodeGoogle(code, callback, minificationLevel){
    for (var i in minifyCache) {
      var item = minifyCache[i];
      if (item.code==code && item.level==minificationLevel) {
        console.log("Found code in minification cache - using that");
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
        Espruino.Core.Notifications.info('No error. Minifying ' + code.length + ' bytes to ' + minified.length + ' bytes.');
        if (minifyCache.length>100)
          minifyCache = minifyCache.slice(-100);
        minifyCache.push({ level : minificationLevel, code : code, minified : minified });
        callback(minified);
      } else {
        Espruino.Core.Notifications.warning("Errors while minifying - sending unminified code.");
        callback(code);
        // get errors...
        closureCompilerGoogle(code,  minificationLevel, 'errors',function(errors) {
          errors.split("\n").forEach(function (err) {
            if (err.trim()!="")
              Espruino.Core.Notifications.error(err.trim());
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
        Espruino.Core.Notifications.error("HTTP error while minifying.");
      })
      .complete(function() {
        // ensure we call the callback even if minification failes
        callback(code);
      });
    }
  }

  function minify(code, callback, level, isModule) {
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
      case "ADVANCED_OPTIMIZATIONS": minifyCodeGoogle(code, callback, level); break;
      case "ESPRIMA": minifyCodeEsprima(code, callback); break;
      default: callback(code); break;
    }
  }

  Espruino.Plugins.Minify = {
    init : init,
  };
}());
