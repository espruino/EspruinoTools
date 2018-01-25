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
  if ("undefined"==typeof utf8) {
    if ("undefined"!=typeof require) var utf8 = require('utf8');
    else var utf8 = { encode : function(c){return c} };
  }

  function init() {
    Espruino.addProcessor("transformForEspruino", function(code, callback) {
      escapeUnicode(code, callback);
    });
  }

  function escapeUnicode(code, callback) {
    // Only correct unicode inside strings
    var newCode = "";
    var lex = Espruino.Core.Utils.getLexer(code);
    var lastIdx = 0;
    var tok = lex.next();
    while (tok!==undefined) {
      var previousString = code.substring(lastIdx, tok.startIdx);
      var tokenString = code.substring(tok.startIdx, tok.endIdx);
      if (tok.type=="STRING") {
        var newTokenString = "";
        for (var i=0;i<tokenString.length;i++) {
          var ch = tokenString.charCodeAt(i);
          if (ch >= 255)
            newTokenString += escapeChar(tokenString[i]);
          else
            newTokenString += tokenString[i];
        }
        tokenString = newTokenString;
      }
      newCode += previousString+tokenString;
      // next
      lastIdx = tok.endIdx;
      tok = lex.next();
    }
    newCode += code.substring(lastIdx);
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
