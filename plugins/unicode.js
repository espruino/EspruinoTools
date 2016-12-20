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

  // Node.js doesn't have utf8 installed
  if ("undefined"==typeof utf8) var utf8 = require('utf8');

  function init() {
    Espruino.addProcessor("transformForEspruino", function(code, callback) {
      escapeUnicode(code, callback);
    });
  }

  function escapeUnicode(code, callback) {
    var newCode = [];
    var idx = 0;

    for (var i = 0; i < code.length; ++i) {
      var ch = code.charCodeAt(i);
      if (ch >= 128 && ch!=172/*¬*/ && ch!=163/*£*/ && ch!=160/*non-breaking space*/) {
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
