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
      descriptionHTML : 'How should code be uploaded? See <a href="http://www.espruino.com/Saving" target="_blank">espruino.com/Saving</a> for more information.<br>'+
                        "<b>NOTE:</b> Avoid 'Direct to flash, even after <code>reset()</code>' for normal development - it can make it hard to recover if your code crashes the device.",
      type : {
    // -1: is used by the app loader to signify that we want the code as-is (app loader adds write statements). Allows pretokenise to correctly check if we're writing to RAM or not
        0: "To RAM (default) - execute code while uploading. Use 'save()' to save a RAM image to Flash",
        1: "Direct to Flash (execute code at boot)",
        2: "Direct to Flash (execute code at boot, even after 'reset()') - USE WITH CARE",
        3: "To Storage File (see 'File in Storage to send to')",
      },
      defaultValue : 0
    });
    Espruino.Core.Config.add("SAVE_STORAGE_FILE", {
      section : "Communications",
      name : "Send to File in Storage",
      descriptionHTML : "If <code>Save on Send</code> is set to <code>To Storage File</code>, this is the name of the file to write to.",
      type : "string",
      defaultValue : "myapp"
    });
    Espruino.Core.Config.add("LOAD_STORAGE_FILE", {
      section : "Communications",
      name : "Load after saving",
      descriptionHTML : "This applies only if saving to Flash (not RAM)",
      type : {
        0: "Don't load",
        1: "Load default application",
        2: "Load the Storage File just written to"
      },
      defaultValue : 2
    });
    Espruino.addProcessor("transformForEspruino", function(code, callback) {
      wrap(code, callback);
    });
  }

  function wrap(code, callback) {
    // convert any non-0..255 charcodes to UTF8 encoding
    code = Espruino.Core.Utils.asUTF8Bytes(code);
    // Depending on settings, choose how we package code for upload
    var isFlashPersistent = Espruino.Config.SAVE_ON_SEND == 2;
    var isStorageUpload = Espruino.Config.SAVE_ON_SEND == Espruino.Core.Send.SEND_MODE_STORAGE;
    var isSDCardUpload = Espruino.Config.SAVE_ON_SEND == Espruino.Core.Send.SEND_MODE_SDCARD;
    var isFlashUpload = Espruino.Config.SAVE_ON_SEND == Espruino.Core.Send.SEND_MODE_FLASH || isFlashPersistent || isStorageUpload;
    if (!isFlashUpload && !isSDCardUpload) return callback(code);

    var asJS = Espruino.Core.Utils.toJSONishString;

    // Check environment vars
    var hasStorage = false;
    var ENV = Espruino.Core.Env.getData();
    if (ENV &&
        ENV.VERSION_MAJOR &&
        ENV.VERSION_MINOR!==undefined) {
      if (ENV.VERSION_MAJOR>1 ||
          ENV.VERSION_MINOR>=96) {
        hasStorage = true;
      }
    }
    const CHUNKSIZE = 1024;

     // Now create the commands to do the upload
    console.log("Uploading "+code.length+" bytes to flash");
    // FIXME: We should use Serial's Connection class packet stuff for file uploads
    if (!hasStorage) { // old style
      if (isStorageUpload || isSDCardUpload) {
        Espruino.Core.Notifications.error("You have pre-1v96 firmware - unable to upload to Storage");
        code = "";
      } else {
        Espruino.Core.Notifications.error("You have pre-1v96 firmware. Upload size is limited by available RAM");
        code = "E.setBootCode("+asJS(code)+(isFlashPersistent?",true":"")+");";
      }
    } else if (isSDCardUpload) {
      var filename = Espruino.Config.SAVE_STORAGE_FILE;;
      var newCode = [ `let _ul = E.openFile(${asJS(filename)},"w");` ];
        var len = code.length;
      for (var i=0;i<len;i+=CHUNKSIZE)
        newCode.push(`_ul.write(${asJS(code.substr(i,CHUNKSIZE))});`);
      newCode.push(`_ul.close();delete _ul;`);
      code = newCode.join("\n");
    } else { // new style
      var filename;
      if (isStorageUpload)
        filename = Espruino.Config.SAVE_STORAGE_FILE;
      else
        filename = isFlashPersistent ? ".bootrst" : ".bootcde";
      if (!filename || filename.length>28) {
        Espruino.Core.Notifications.error("Invalid Storage file name "+JSON.stringify(filename));
        code = "";
      } else {
        var newCode = [];
        var len = code.length;
        newCode.push('require("Storage").write('+asJS(filename)+','+asJS(code.substr(0,CHUNKSIZE))+',0,'+len+');');
        for (var i=CHUNKSIZE;i<len;i+=CHUNKSIZE)
          newCode.push('require("Storage").write('+asJS(filename)+','+asJS(code.substr(i,CHUNKSIZE))+','+i+');');
        code = newCode.join("\n");
      }
    }
    if (Espruino.Config.LOAD_STORAGE_FILE==2 && isStorageUpload)
      code += "\nload("+asJS(filename)+")\n";
    else if (Espruino.Config.LOAD_STORAGE_FILE!=0)
      code += "\nload()\n";
    else code += "\n";
    callback(code);
  }

  Espruino.Plugins.SaveOnSend = {
    init : init,
    sortOrder : 1000, // after most plugins, before setTime
  };
}());
