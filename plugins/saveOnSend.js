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
      description : "Save the code after sending so that it is executed again as is on board restart",
      type : "boolean",
      defaultValue : false
    });    

    Espruino.addProcessor("transformForEspruino", function(code, callback) {
      wrap(code, callback);
    });
  }

  function wrap(code, callback) {
    if (!Espruino.Config.SAVE_ON_SEND) return callback(code);

    var newCode = [];
    newCode.push("E.setBootCode(");
    newCode.push(JSON.stringify(code));
    newCode.push(");\n");
    newCode.push("reset();");
    newCode.push("load();");
    newCode = newCode.join('');

    console.log('Save on send transformed code to:', newCode);
    callback(newCode);
  }
  
  Espruino.Plugins.SaveOnSend = {
    init : init,
  };
}());
