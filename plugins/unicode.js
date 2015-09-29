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
    var lex = Espruino.Core.Utils.getLexer(code);
    var newCode = [];

    // Lexer doesn't emit white space tokens, so we'll scan source
    // and push substring portions of original code one after one.
    // Once we stumble upon string literal we'll escape it and push
    // that result
    var idx = 0;

    for (var tok = lex.next(); tok !== undefined; tok = lex.next()) {
      if (tok.type === 'STRING') {
        newCode.push(escapeStringToken(tok.str));
      } else {
        newCode.push(code.substring(idx, tok.endIdx));
      }

      idx = tok.endIdx;
    }

    newCode = newCode.join('');
    callback(newCode);
  }

  function escapeStringToken(str) {
    var len = str.length;
    var result;

    // open quote
    result = str.charAt(0);

    for (var i = 1; i < len - 1; ++i) {
      if (str.charCodeAt(i) < 128) {
        // skip ASCII chars since UTF-8 leave them as is
        result += str.charAt(i);
      } else {
        // encode non-ASCII char into UTF-8 sequence and
        // add it in form of \xHH codes
        utf8.encode(str.charAt(i)).split('').forEach(function(c) {
          var code = c.charCodeAt(0);
          result += "\\x";
          if (code < 0x10) {
            result += '0';
          }

          result += code.toString(16).toUpperCase();
        });
      }
    }

    // closing quote
    result += str.charAt(len - 1);

    return result;
  }

  Espruino.Plugins.Unicode = {
    init : init,
  };
}());
