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
  if (typeof require === undefined) return;
  
  function init() {
    Espruino.addProcessor("getModule", function (data, callback) {      
      if (fs.existsSync("modules/"+data.moduleName)) {
        console.log("Loading local module "+"modules/"+data.moduleName);
        data.moduleCode = fs.readFileSync("modules/"+data.moduleName).toString();
      } else if (fs.existsSync(data.moduleName)) {
        console.log("Loading local module "+data.moduleName);
        data.moduleCode = fs.readFileSync(data.moduleName).toString();
      }
      callback(data);
    });
  }
  
  Espruino.Plugins.LocalModules = {
    init : init,
  };
}());
