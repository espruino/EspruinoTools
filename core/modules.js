/**
 Copyright 2014 Gordon Williams (gw@pur3.co.uk)

 This Source Code is subject to the terms of the Mozilla Public
 License, v2.0. If a copy of the MPL was not distributed with this
 file, You can obtain one at http://mozilla.org/MPL/2.0/.

 ------------------------------------------------------------------
  Automatically load any referenced modules
 ------------------------------------------------------------------
**/
"use strict";
(function(){

  function init() {
    Espruino.Core.Config.add("MODULE_URL", {
      section : "Communications",
      name : "Module URL",
      description : "Where to search online for modules when `require()` is used. Can supply more than one URL, separated by '|'",
      type : "string",
      defaultValue : "https://www.espruino.com/modules"
    });
    Espruino.Core.Config.add("MODULE_EXTENSIONS", {
      section : "Communications",
      name : "Module Extensions",
      description : "The file extensions to use for each module. These are checked in order and the first that exists is used. One or more file extensions (including the dot) separated by `|`",
      type : "string",
      defaultValue : ".min.js|.js"
    });
    Espruino.Core.Config.add("MODULE_AS_FUNCTION", {
      section : "Communications",
      name : "Modules uploaded as functions",
      description : "Espruino 1v90 and later ONLY. Upload modules as Functions, allowing any functions inside them to be loaded directly from flash when 'Save on Send' is enabled.",
      type : "boolean",
      defaultValue : true
    });

    Espruino.Core.Config.add("MODULE_PROXY_ENABLED", {
      section : "Communications",
      name : "Enable Proxy",
      description : "Enable Proxy for loading the modules when `require()` is used (only in native IDE)",
      type : "boolean",
      defaultValue : false
    });

    Espruino.Core.Config.add("MODULE_PROXY_URL", {
      section : "Communications",
      name : "Proxy URL",
      description : "Proxy URL for loading the modules when `require()` is used (only in native IDE)",
      type : "string",
      defaultValue : ""
    });

    Espruino.Core.Config.add("MODULE_PROXY_PORT", {
      section : "Communications",
      name : "Proxy Port",
      description : "Proxy Port for loading the modules when `require()` is used (only in native IDE)",
      type : "string",
      defaultValue : ""
    });

    // When code is sent to Espruino, search it for modules and add extra code required to load them
    Espruino.addProcessor("transformForEspruino", function(code, callback) {
      loadModules(code, callback);
    });

    // Append the 'getModule' processor as the last (plugins get initialized after Espruino.Core modules)
    Espruino.Plugins.CoreModules = {
      init: function() {
        Espruino.addProcessor("getModule", function(data, callback) {
          if (data.moduleCode!==undefined) { // already provided be previous getModule processor
            return callback(data);
          }

          fetchGetModule(data, callback);
        });
      }
    };
  }

  function isBuiltIn(module) {
    var d = Espruino.Core.Env.getData();
    // If we got data from the device itself, use that as the
    // definitive answer
    if ("string" == typeof d.MODULES)
      return d.MODULES.split(",").indexOf(module)>=0;
    // Otherwise try and figure it out from JSON
    if ("info" in d &&
        "builtin_modules" in d.info &&
        d.info.builtin_modules.indexOf(module)>=0)
      return true;
    // Otherwise assume we don't have it
    return false;
  }

  /** Find any instances of require(...) in the code string and return a list */
  var getModulesRequired = function(code) {
    var modules = [];

    var lex = Espruino.Core.Utils.getLexer(code);
    var tok = lex.next();
    var state = 0;
    while (tok!==undefined) {
      if (state==0 && tok.str=="require") {
        state=1;
      } else if (state==1 && tok.str=="(") {
        state=2;
      } else if (state==2 && (tok.type=="STRING")) {
        state=0;
        var module = tok.value;
        if (!isBuiltIn(module) && modules.indexOf(module)<0)
          modules.push(module);
      } else
        state = 0;
      tok = lex.next();
    }

    return modules;
  };

  /** Download modules from MODULE_URL/.. */
  function fetchGetModule(data, callback) {
    var fullModuleName = data.moduleName;

    // try and load the module the old way...
    console.log("loadModule("+fullModuleName+")");

    var urls = []; // Array of where to look for this module
    var modName; // Simple name of the module
    if(Espruino.Core.Utils.isURL(fullModuleName)) {
      modName = fullModuleName.substr(fullModuleName.lastIndexOf("/") + 1).split(".")[0];
      urls = [ fullModuleName ];
    } else {
      modName = fullModuleName;
      Espruino.Config.MODULE_URL.split("|").forEach(function (url) {
        url = url.trim();
        if (url.length!=0)
        Espruino.Config.MODULE_EXTENSIONS.split("|").forEach(function (extension) {
          urls.push(url + "/" + fullModuleName + extension);
        })
      });
    };

    // Recursively go through all the urls
    (function download(urls) {
      if (urls.length==0) {
        return callback(data);
      }
      var dlUrl = urls[0];
      Espruino.Core.Utils.getURL(dlUrl, function (code) {
        if (code!==undefined) {
          // we got it!
          data.moduleCode = code;
          data.isMinified = dlUrl.substr(-7)==".min.js";
          return callback(data);
        } else {
          // else try next
          download(urls.slice(1));
        }
      });
    })(urls);
  }


  /** Called from loadModule when a module is loaded. Parse it for other modules it might use
   *  and resolve dfd after all submodules have been loaded */
  function moduleLoaded(resolve, requires, modName, data, loadedModuleData, alreadyMinified){
    // Check for any modules used from this module that we don't already have
    var newRequires = getModulesRequired(data);
    console.log(" - "+modName+" requires "+JSON.stringify(newRequires));
    // if we need new modules, set them to load and get their promises
    var newPromises = [];
    for (var i in newRequires) {
      if (requires.indexOf(newRequires[i])<0) {
        console.log("   Queueing "+newRequires[i]);
        requires.push(newRequires[i]);
        newPromises.push(loadModule(requires, newRequires[i], loadedModuleData));
      } else {
        console.log("   Already loading "+newRequires[i]);
      }
    }

    var loadProcessedModule = function (module) {
      // if we needed to load something, wait until it's loaded before resolving this
      Promise.all(newPromises).then(function(){
        // add the module to end of our array
        if (Espruino.Config.MODULE_AS_FUNCTION)
          loadedModuleData.push("Modules.addCached(" + JSON.stringify(module.name) + ",function(){" + module.code + "});");
        else
          loadedModuleData.push("Modules.addCached(" + JSON.stringify(module.name) + "," + JSON.stringify(module.code) + ");");
        // We're done
        resolve();
      });
    }
    if (alreadyMinified)
      loadProcessedModule({code:data,name:modName});
    else
      Espruino.callProcessor("transformModuleForEspruino", {code:data,name:modName}, loadProcessedModule);
  }

  /** Given a module name (which could be a URL), try and find it. Return
   * a deferred thingybob which signals when we're done. */
  function loadModule(requires, fullModuleName, loadedModuleData) {
    return new Promise(function(resolve, reject) {
      // First off, try and find this module using callProcessor
      Espruino.callProcessor("getModule",
        { moduleName:fullModuleName, moduleCode:undefined, isMinified:false },
        function(data) {
          if (data.moduleCode===undefined) {
            Espruino.Core.Notifications.warning("Module "+fullModuleName+" not found");
            return resolve();
          }

          // great! it found something. Use it.
          moduleLoaded(resolve, requires, fullModuleName, data.moduleCode, loadedModuleData, data.isMinified);
        });
    });
  }

  /** Finds instances of 'require' and then ensures that
   those modules are loaded into the module cache beforehand
   (by inserting the relevant 'addCached' commands into 'code' */
  function loadModules(code, callback){
    var loadedModuleData = [];
    var requires = getModulesRequired(code);
    if (requires.length == 0) {
      // no modules needed - just return
      callback(code);
    } else {
      Espruino.Core.Status.setStatus("Loading modules");
      // Kick off the module loading (each returns a promise)
      var promises = requires.map(function (moduleName) {
        return loadModule(requires, moduleName, loadedModuleData);
      });
      // When all promises are complete
      Promise.all(promises).then(function(){
        callback(loadedModuleData.join("\n") + "\n" + code);
      });
    }
  };


  Espruino.Core.Modules = {
    init : init
  };
}());
