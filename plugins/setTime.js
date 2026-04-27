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
      subSection: "Uploading",
      name : "Set Current Time",
      description : "When sending code, set Espruino's clock to the current time",
      type : "boolean",
      defaultValue : true,
      onChange : function(newValue) {  }
    });

   // Just before code is sent to Espruino, write code that will set the current time and timezone
   Espruino.addProcessor("sending", function(_, callback) {
     if (Espruino.Config.SET_TIME_ON_WRITE) {
       var time = new Date();
       var code = "\x10setTime("+(time.getTime()/1000)+");E.setTimeZone("+(-time.getTimezoneOffset()/60)+")\n";
       Espruino.Core.Serial.write(code, false, callback);
     } else
       callback();
   });
  }

  Espruino.Plugins.SetTime = {
    init : init,
    sortOrder : 1100, // after pretty much everything, speficically saveOnSend
  };
}());
