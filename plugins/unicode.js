/**
 Copyright 2015 Gordon Williams (gw@pur3.co.uk),
                Victor Nakoryakov (victor@amperka.ru)

 This Source Code is subject to the terms of the Mozilla Public
 License, v2.0. If a copy of the MPL was not distributed with this
 file, You can obtain one at http://mozilla.org/MPL/2.0/.
 
 ------------------------------------------------------------------
  Escape non-ASCII characters into \xHH UTF-8 sequences before send
 ------------------------------------------------------------------
**/
"use strict";
(function(){

  function init() {
    Espruino.addProcessor("transformForEspruino", function(code, callback) {
      escapeUnicode(code, callback);
    });
  }

  function escapeUnicode(code, callback) {
    var newCode = [];
    var idx = 0;

    for (var i = 0; i < code.length; ++i) {
      if (code.charCodeAt(i) >= 128) {
        newCode.push(code.substring(idx, i));
        newCode.push(escapeChar(code[i]));
        idx = i + 1;
      }
    }

    newCode.push(code.substring(idx, code.length));

    newCode = newCode.join('');
    callback(newCode);
  }

  function escapeChar(c) {
    // encode char into UTF-8 sequence in form of \xHH codes
    var result = '';
    utf8.encode(c).split('').forEach(function(c) {
      var code = c.charCodeAt(0);
      result += "\\x";
      if (code < 0x10) {
        result += '0';
      }

      result += code.toString(16).toUpperCase();
    });

    return result;
  }

  Espruino.Plugins.Unicode = {
    init : init,
  };
}());
