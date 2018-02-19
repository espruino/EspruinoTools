/**
 Copyright 2014 Gordon Williams (gw@pur3.co.uk)

 This Source Code is subject to the terms of the Mozilla Public
 License, v2.0. If a copy of the MPL was not distributed with this
 file, You can obtain one at http://mozilla.org/MPL/2.0/.

 ------------------------------------------------------------------
   Check for the latest version of the board's software
 ------------------------------------------------------------------
**/
"use strict";
(function(){

  function init() {
    // Configuration
    Espruino.Core.Config.add("SERIAL_THROTTLE_SEND", {
      section : "Communications",
      name : "Throttle Send",
      description : "Throttle code when sending to Espruino? If you are experiencing lost characters when sending code from the Code Editor pane, this may help.",
      type : "boolean",
      defaultValue : false,
      onChange : function() {
        checkEnv(Espruino.Core.Env.getData());
      }
    });

    // must be AFTER boardJSON
    Espruino.addProcessor("environmentVar", function(env, callback) {
      checkEnv(env);
      callback(env);
    });

    Espruino.addProcessor("flashComplete", function(env, callback) {
      if (Espruino.Core.App) {
        var icon = Espruino.Core.App.findIcon("update");
        if(icon) icon.remove();
      }

      callback(env);
    });

    Espruino.addProcessor("disconnected", function(env, callback) {
      if (Espruino.Core.App) {
        var icon = Espruino.Core.App.findIcon("update");
        if(icon) icon.remove();
      }

      callback(env);
    });
  }

  function checkEnv(env) {
    if (env!==undefined &&
        env.VERSION!==undefined) {
      var tCurrent = env.VERSION;
      var vCurrent = Espruino.Core.Utils.versionToFloat(tCurrent);

      if (vCurrent > 1.43 &&
          (env.CONSOLE=="USB"||env.CONSOLE=="Bluetooth"||env.CONSOLE=="Telnet")) {
        console.log("Firmware >1.43 supports faster writes over USB");
        Espruino.Core.Serial.setSlowWrite(false);
      } else {
        Espruino.Core.Serial.setSlowWrite(true);
      }

      if (env.info!==undefined &&
          env.info.binary_version!==undefined) {
        var tAvailable = env.info.binary_version;
        var vAvailable = Espruino.Core.Utils.versionToFloat(tAvailable);

        console.log("FIRMWARE: Current "+tCurrent+", Available "+tAvailable);

        if (vAvailable > vCurrent &&
          (env.BOARD=="ESPRUINOBOARD" ||
           env.BOARD.substr(0,4)=="PICO" ||
           env.BOARD=="ESPRUINOWIFI" ||
           env.BOARD=="PUCKJS")) {
          console.log("New Firmware "+tAvailable+" available");
          Espruino.Core.Notifications.info("New Firmware available ("+vCurrent+" installed, "+tAvailable+" available)");

          if (Espruino.Core.App) Espruino.Core.App.addAlertIcon({
            id:'update',
            title: 'New Firmware '+ tAvailable +' available. Click to update.',
            click: function(){
              Espruino.Core.MenuSettings.show("Flasher");
            }
          });
        }
      }
    }
  }

  Espruino.Plugins.VersionChecker = {
    init : init,
  };
}());
