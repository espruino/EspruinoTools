/**
 Copyright 2014 Gordon Williams (gw@pur3.co.uk)

 This Source Code is subject to the terms of the Mozilla Public
 License, v2.0. If a copy of the MPL was not distributed with this
 file, You can obtain one at http://mozilla.org/MPL/2.0/.
 
 ------------------------------------------------------------------
  Ability to set the current time in Espruino
 ------------------------------------------------------------------
**/
"use strict";
(function(){
  
  function init() {
    Espruino.Core.Config.add("SET_TIME_ON_WRITE", {
      section : "Communications",
      name : "Set Current Time",
      description : "When sending code, set Espruino's clock to the current time",
      type : "boolean",
      defaultValue : false, 
      onChange : function(newValue) {  }
    });

   // When code is sent to Espruino, append code to set the current time
   Espruino.addProcessor("transformForEspruino", function(code, callback) {
     if (Espruino.Config.SET_TIME_ON_WRITE) {
       code = "setTime("+(Date.now()/1000)+");\n"+code;
     }
     callback(code);
   });
  }
  
  Espruino.Plugins.ExamplePlugin = {
    init : init,
  };
}());
