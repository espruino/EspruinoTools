/**
 Copyright 2014 Gordon Williams (gw@pur3.co.uk)

 This Source Code is subject to the terms of the Mozilla Public
 License, v2.0. If a copy of the MPL was not distributed with this
 file, You can obtain one at http://mozilla.org/MPL/2.0/.

 ------------------------------------------------------------------
  Handle Local modules in node.js
 ------------------------------------------------------------------
**/
"use strict";
(function(){
  // Not using node - don't run this
  if (typeof require == "undefined") return;

  var path = require('path');

  function init() {
    Espruino.Core.Config.add("MODULES_DIR_NAME", {
      section : "Communications",
      name : "Espruino modules folder name",
      description : "Name of the folder containing espruino modules.",
      type : "string",
      defaultValue : "modules"
    });
    Espruino.Core.Config.add("MODULES_CWD", {
      section : "Communications",
      name : "Path to modules",
      description : "The filesystem path to use when looking for modules. When calling require('./foo.js') it will load the file at MODULES_CWD+'./foo.js'.",
      type : "string",
      defaultValue : ""
    });

    Espruino.addProcessor("getModule", function (data, callback) {
      var espruino_modules = Espruino.Config.MODULES_DIR_NAME;
      var cwd = Espruino.Config.MODULES_CWD;
      if (!cwd) cwd = process.cwd();

        /**
         * Implements the require.resolve() rules as per node
         * (ref: https://nodejs.org/api/modules.html#modules_all_together)
         * except currently where noted in the comments.
         *
         * The default path for modules is './modules'
         * although I propose this should be changed to './espruino_modules'
         * to put it in the espruino namespace
         * and/or this could be made a user-definable parameter
         *
         */
        function loadJSFile(x) {
            console.log("Loading local module "+ x +" for " + data.moduleName);
            data.moduleCode = fs.readFileSync(x).toString();
            return true;
        }

        function loadJSONFile(x) {
            console.log("Loading local module "+ x +" for " + data.moduleName);
            console.log('module.exports=' + JSON.stringify(JSON.parse(fs.readFileSync(x).toString())) + ';');
            data.moduleCode = 'module.exports=' + JSON.stringify(JSON.parse(fs.readFileSync(x).toString())) + ';';
            return true;
        }

        function loadPackageMainFile(x) {
            var pkg = JSON.parse(fs.readFileSync(path.join(x,'package.json')).toString());
            if (pkg && pkg.main) loadAsFile(path.join(x,pkg.main));
            return false;
        }

        function isFile(x) {
            try {
                return fs.statSync(x).isFile();
            } catch (e) {
                return false;
            }
        }

        function loadAsFile(x) {
            if (isFile(x)) return loadJSFile(x);
            else if(isFile(x+'.js')) return loadJSFile(x+'.js');
            else if(isFile(x+'.json')) return loadJSONFile(x+'.json');
            /** currently don't allow for .node **/
            return false;
        }

        function loadAsDirectory(x) {
            if (isFile(path.join(x,'package.json'))) return loadPackageMainFile(x);
            if (isFile(path.join(x,'index.js'))) return loadJSFile(path.join(x,'index.js'));
            if (isFile(path.join(x,'index.json'))) return loadJSONFile(path.join(x,'index.json'));
            /** currently don't allow for index.node **/
            return false;
        }

        function loadModule(x){
            return loadAsFile(x) || loadAsDirectory(x);
        }

        function loadEspModules(x, start) {
          var current;
          do {
            current = start;
            if (loadModule(path.join(current,espruino_modules,x))) return true;
            start = path.resolve(current, '..');
          } while (current !== start);

          return false;
        }

        /**
         * todo: could look at boardJSON.info.builtin_modules and handle nicely but not necessary to have work
         */
        var x = data.moduleName;
        if (x.indexOf('./')==0 || x.indexOf('/')==0 || x.indexOf('../')==0) {
            loadModule(path.join(cwd,x));
        } else {
            loadEspModules(x,cwd);
        }

      callback(data);
    });
  }

  Espruino.Plugins.LocalModules = {
    init : init,
  };
}());
