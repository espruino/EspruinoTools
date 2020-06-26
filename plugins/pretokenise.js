/**
 Copyright 2014 Gordon Williams (gw@pur3.co.uk)

 This Source Code is subject to the terms of the Mozilla Public
 License, v2.0. If a copy of the MPL was not distributed with this
 file, You can obtain one at http://mozilla.org/MPL/2.0/.

 ------------------------------------------------------------------
  Pretokenise code before it uploads
 ------------------------------------------------------------------
**/
"use strict";
(function(){
  if (typeof acorn == "undefined") {
    console.log("pretokenise: needs acorn, disabling.");
    return;
  }

  function init() {
    Espruino.Core.Config.add("PRETOKENISE", {
      section : "Minification",
      name : "Pretokenise code before upload (BETA)",
      description : "All whitespace and comments are removed and all reserved words are converted to tokens before upload. This means a faster upload, less memory used, and increased performance (+10%) at the expense of code readability.",
      type : "boolean",
      defaultValue : false
    });

    // When code is sent to Espruino, search it for modules and add extra code required to load them
    Espruino.addProcessor("transformForEspruino", function(code, callback) {
      if (!Espruino.Config.PRETOKENISE) return callback(code);
      pretokenise(code, callback);
    });
   // When code is sent to Espruino, search it for modules and add extra code required to load them
    Espruino.addProcessor("transformModuleForEspruino", function(module, callback) {
      if (!Espruino.Config.PRETOKENISE) return callback(module);
      pretokenise(module.code, function(code) {
        module.code = code;
        callback(module);
      });
    });
  }


  var LEX_OPERATOR_START = 138;
  var TOKENS =  [// plundered from jslex.c
/* LEX_EQUAL      :   */ "==",
/* LEX_TYPEEQUAL  :   */ "===",
/* LEX_NEQUAL     :   */ "!=",
/* LEX_NTYPEEQUAL :   */ "!==",
/* LEX_LEQUAL    :    */ "<=",
/* LEX_LSHIFT     :   */ "<<",
/* LEX_LSHIFTEQUAL :  */ "<<=",
/* LEX_GEQUAL      :  */ ">=",
/* LEX_RSHIFT      :  */ ">>",
/* LEX_RSHIFTUNSIGNED */ ">>>",
/* LEX_RSHIFTEQUAL :  */ ">>=",
/* LEX_RSHIFTUNSIGNEDEQUAL */ ">>>=",
/* LEX_PLUSEQUAL   :  */ "+=",
/* LEX_MINUSEQUAL  :  */ "-=",
/* LEX_PLUSPLUS :     */ "++",
/* LEX_MINUSMINUS     */ "--",
/* LEX_MULEQUAL :     */ "*=",
/* LEX_DIVEQUAL :     */ "/=",
/* LEX_MODEQUAL :     */ "%=",
/* LEX_ANDEQUAL :     */ "&=",
/* LEX_ANDAND :       */ "&&",
/* LEX_OREQUAL :      */ "|=",
/* LEX_OROR :         */ "||",
/* LEX_XOREQUAL :     */ "^=",
/* LEX_ARROW_FUNCTION */ "=>",
// reserved words
/*LEX_R_IF :       */ "if",
/*LEX_R_ELSE :     */ "else",
/*LEX_R_DO :       */ "do",
/*LEX_R_WHILE :    */ "while",
/*LEX_R_FOR :      */ "for",
/*LEX_R_BREAK :    */ "break",
/*LEX_R_CONTINUE   */ "continue",
/*LEX_R_FUNCTION   */ "function",
/*LEX_R_RETURN     */ "return",
/*LEX_R_VAR :      */ "var",
/*LEX_R_LET :      */ "let",
/*LEX_R_CONST :    */ "const",
/*LEX_R_THIS :     */ "this",
/*LEX_R_THROW :    */ "throw",
/*LEX_R_TRY :      */ "try",
/*LEX_R_CATCH :    */ "catch",
/*LEX_R_FINALLY :  */ "finally",
/*LEX_R_TRUE :     */ "true",
/*LEX_R_FALSE :    */ "false",
/*LEX_R_NULL :     */ "null",
/*LEX_R_UNDEFINED  */ "undefined",
/*LEX_R_NEW :      */ "new",
/*LEX_R_IN :       */ "in",
/*LEX_R_INSTANCEOF */ "instanceof",
/*LEX_R_SWITCH     */ "switch",
/*LEX_R_CASE       */ "case",
/*LEX_R_DEFAULT    */ "default",
/*LEX_R_DELETE     */ "delete",
/*LEX_R_TYPEOF :   */ "typeof",
/*LEX_R_VOID :     */ "void",
/*LEX_R_DEBUGGER : */ "debugger",
/*LEX_R_CLASS :    */ "class",
/*LEX_R_EXTENDS :  */ "extends",
/*LEX_R_SUPER :  */   "super",
/*LEX_R_STATIC :   */ "static",
/*LEX_R_OF    :   */  "of"
];


  function pretokenise(code, callback) {
    var lex = (function() {
      var t = acorn.tokenizer(code);
      return { next : function() {
        var tk = t.getToken();
        if (tk.type.label=="eof") return undefined;
        var tp = "?";
        if (tk.type.label=="template" || tk.type.label=="string") tp="STRING";
        if (tk.type.label=="num") tp="NUMBER";
        if (tk.type.keyword || tk.type.label=="name") tp="ID";
        if (tp=="?" && tk.start+1==tk.end) tp="CHAR";
        return {
          startIdx : tk.start,
          endIdx : tk.end,
          str : code.substring(tk.start, tk.end),
          type : tp
        };
      }};
    })();
    var brackets = 0;
    var resultCode = "";
    var lastIdx = 0;
    var lastTok = {str:""};
    var tok = lex.next();
    while (tok!==undefined) {
      var previousString = code.substring(lastIdx, tok.startIdx);
      var tokenString = code.substring(tok.startIdx, tok.endIdx);
      var tokenId = LEX_OPERATOR_START + TOKENS.indexOf(tokenString);
      if (tokenId<LEX_OPERATOR_START) tokenId=undefined;
      // Workaround for https://github.com/espruino/Espruino/issues/1868
      if (tokenString=="catch") tokenId=undefined;
      //console.log("prev "+JSON.stringify(previousString)+"   next "+tokenString);

      if (tok.str=="(" || tok.str=="{" || tok.str=="[") brackets++;
      // TODO: check for eg. two IDs/similar which can't be merged without a space
      // preserve newlines at root scope to avoid us filling up the command buffer all at once
      if (brackets==0 && previousString.indexOf("\n")>=0)
        resultCode += "\n";
      if (tok.str==")" || tok.str=="}" || tok.str=="]") brackets--;
      // if we have a token for something, use that - else use the string
      if (tokenId) {
        //console.log(JSON.stringify(tok.str)+" => "+tokenId);
        resultCode += String.fromCharCode(tokenId);
        tok.type = "TOKENISED";
      } else {
        if ((tok.type=="ID" || tok.type=="NUMBER") &&
            (lastTok.type=="ID" || lastTok.type=="NUMBER"))
          resultCode += " ";
        resultCode += tokenString;
      }
      // next
      lastIdx = tok.endIdx;
      lastTok = tok;
      tok = lex.next();
    }
    callback(resultCode);
  }

  Espruino.Plugins.Pretokenise = {
    init : init,
  };
}());
