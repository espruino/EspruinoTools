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
      description : "Save the code after sending so that everything is executed again when the board restarts. Not as memory efficient, but more Arduino-like.",
      type : {
        0: "No",
        1: "Yes",
        2: "Yes, execute even after 'reset()'"},
      defaultValue : 0
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
    if (Espruino.Config.SAVE_ON_SEND==2)
      newCode.push(", true);");
    else
      newCode.push(");");
    newCode.push("load();\n");
    newCode = newCode.join('');

    console.log('Save on send transformed code to:', newCode);
    callback(newCode);
  }

  Espruino.Plugins.SaveOnSend = {
    init : init,
  };
}());
