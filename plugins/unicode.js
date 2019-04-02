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
  var utf8lib;
  if ("undefined"==typeof utf8) {    
    if ("undefined"!=typeof require) {
      console.log("Loading UTF8 with require");
      utf8lib = require('utf8');
    } else {
      console.log("WARNING: Loading placeholder UTF8");
      utf8lib = { encode : function(c){return c} };
    }
  } else {
    console.log("UTF8 Library loaded successfully");
    utf8lib = utf8;
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
    utf8lib.encode(c).split('').forEach(function(c) {
      var code = c.charCodeAt(0) & 0xFF;
      result += "\\x";
      if (code < 0x10) result += '0';
      result += code.toString(16).toUpperCase();
    });

    return result;
  }

  Espruino.Plugins.Unicode = {
    init : init,
  };
}());
