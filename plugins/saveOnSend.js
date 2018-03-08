/**
 Copyright 2014 Gordon Williams (gw@pur3.co.uk),
                Victor Nakoryakov (victor@amperka.ru)

 This Source Code is subject to the terms of the Mozilla Public
 License, v2.0. If a copy of the MPL was not distributed with this
 file, You can obtain one at http://mozilla.org/MPL/2.0/.

 ------------------------------------------------------------------
  Wrap whole code in `onInit` function before send and save() it
  after upload. Wrapping is necessary to avoid execution start
  before save() is executed
 ------------------------------------------------------------------
**/
"use strict";
(function(){

  function init() {
    Espruino.Core.Config.add("SAVE_ON_SEND", {
      section : "Communications",
      name : "Save on Send",
      descriptionHTML : 'How should code be uploaded? See <a href="http://www.espruino.com/Saving" target="_blank">espruino.com/Saving</a> for more information.',
      type : {
        0: "To RAM (default) - execute code while uploading. Use 'save()' to save a RAM image to Flash",
        1: "Direct to Flash (execute code at boot)",
        2: "Direct to Flash (execute code at boot, even after a call to 'reset()')",
      },
      defaultValue : 0
    });
    Espruino.addProcessor("transformForEspruino", function(code, callback) {
      wrap(code, callback);
    });
  }

  function wrap(code, callback) {
    var isFlashPersistent = Espruino.Config.SAVE_ON_SEND == 2;
    var isFlashUpload = Espruino.Config.SAVE_ON_SEND == 1 || isFlashPersistent;
    if (!isFlashUpload) return callback(code);

    // Check environment vars
    var hasStorage = false;
    var ENV = Espruino.Core.Env.getData();
    if (ENV && ENV.VERSION_MAJOR && ENV.VERSION_MINOR) {
      if (ENV.VERSION_MAJOR>1 ||
          ENV.VERSION_MINOR>=96) {
        hasStorage = true;
      }
    }

    //
    console.log("Uploading "+code.length+" bytes to flash");
    if (!hasStorage) { // old style
      Espruino.Core.Notifications.error("You have pre-1v96 firmware. Upload size is limited by available RAM");
      code = "E.setBootCode("+JSON.stringify(code)+(isFlashPersistent?",true":"")+");load()\n";
    } else { // new style
      var filename = isFlashPersistent ? ".bootrst" : ".bootcde";
      var CHUNKSIZE = 1024;
      var newCode = [];
      var len = code.length;
      newCode.push('require("Storage").write("'+filename+'",'+JSON.stringify(code.substr(0,CHUNKSIZE))+',0,'+len+');');
      for (var i=CHUNKSIZE;i<len;i+=CHUNKSIZE)
        newCode.push('require("Storage").write("'+filename+'",'+JSON.stringify(code.substr(i,CHUNKSIZE))+','+i+');');
      code = newCode.join("\n")+"\nload()\n";
    }
    callback(code);
  }

  Espruino.Plugins.SaveOnSend = {
    init : init,
  };
}());
