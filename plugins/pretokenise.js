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
      name : "Pretokenise code before upload",
      description : "All whitespace and comments are removed and all reserved words are converted to tokens before upload. This means a faster upload, less memory used, and increased performance (+10%) at the expense of code readability.",
      type : {
        0: "Never",
        1: "Auto (tokenise Strings on 2v20.48 or later)",
        2: "Yes (always tokenise everything, regardless of version)"
      },
      defaultValue : 0
    });

    // When code is sent to Espruino, search it for modules and add extra code required to load them
    Espruino.addProcessor("transformForEspruino", function(code, callback) {
      if (!Espruino.Config.PRETOKENISE) return callback(code);
      if (Espruino.Config.SAVE_ON_SEND == 0) {
        console.log("pretokenise> Can't pretokenise code sent to REPL (RAM)");
        return callback(code);
      }
      pretokenise(code, callback);
    });
   // When code is sent to Espruino, search it for modules and add extra code required to load them
    Espruino.addProcessor("transformModuleForEspruino", function(module, callback) {
      if (!Espruino.Config.PRETOKENISE ||
          Espruino.Config.MODULE_AS_FUNCTION) return callback(module);
      /* if MODULE_AS_FUNCTION is specified the module is uploaded inside a 'function'
      block, in which case it will be pretokenised anyway in a later step */
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

  const LEX_RAW_STRING8 = 0xD1;
  const LEX_RAW_STRING16 = 0xD2;

  function pretokenise(code, callback) {
    callback(tokenise(code));
  }

  function tokenise(code) {
    var pretokeniseStrings = false; // only works on 2v20.48 and later
    var boardData = Espruino.Core.Env.getBoardData();
    if (Espruino.Config.PRETOKENISE==2) {
      pretokeniseStrings = true; // always
    } else if (boardData && boardData.VERSION) {
      var v = parseFloat(boardData.VERSION.replace("v","0"));
      if (v >= 2020.48)
        pretokeniseStrings = true;
    }

    var lex = (function() {
      let t = acorn.tokenizer(code, { ecmaVersion : 2020 });
      return { next : function() {
        let tk = t.getToken();
        let tkStr = code.substring(tk.start, tk.end), tkValue = tk.value;
        if (tk.type.label=="eof") return undefined;
        let tp = "?";
        if (tk.type.label=="`") { // template string
          // acorn splits these up into tokens, so we have to work through to the end, then just include the full text
          let tk2, hasTemplate = false;
          do {
            tk2 = t.getToken();
            if (tk2.type.label=="${")
              hasTemplate = true;
          } while (tk2.type.label!="`");
          tkStr = code.substring(tk.start, tk2.end);
          tp = hasTemplate ? "TEMPLATEDSTRING" : "STRING"; // if we don't have any templates, treat as a normal string (https://github.com/espruino/Espruino/issues/2577)
          tkValue = hasTemplate ? tkStr : eval(tkStr); // don't evaluate if it has templates as it must be done at runtime!
        }
        if (tk.type.label=="string") tp="STRING";
        if (tk.type.label=="num") tp="NUMBER";
        if (tk.type.keyword || tk.type.label=="name") tp="ID";
        if (tp=="?" && tk.start+1==tk.end) tp="CHAR";
        return {
          startIdx : tk.start,
          endIdx : tk.end,
          str : tkStr,
          value : tkValue,
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
      if (pretokeniseStrings && tok.type == "STRING") {
        let str = tok.value;  // get string value
        lastIdx = tok.endIdx; // get next token
        lastTok = tok;
        tok = lex.next();
        let hadAtoB = resultCode.endsWith("atob(") && tok.str==")"; // were we surrounded by 'atob'?
        if (hadAtoB) {
          str = Espruino.Core.Utils.atob(str);
          resultCode = resultCode.substring(0, resultCode.length-5); // remove 'atob('
        }
        let length = str.length;
        if (length==0) { // it's shorter just to write quotes
          resultCode += tokenString;
        } else if (length<256)
          resultCode += String.fromCharCode(LEX_RAW_STRING8, length) + str;
        else if (length<65536)
          resultCode += String.fromCharCode(LEX_RAW_STRING16, length&255, (length>>8)&255)+str;
        if (!hadAtoB) continue; // if not atob, we already got the last token ready
      } else if (tokenId) {
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
    return resultCode;
  }

  function isTokenised(code) {
    for (var i=0;i<code.length;i++) {
      var ch = code.charCodeAt(i);
      // check for chars out of range
      if (ch>=LEX_OPERATOR_START+TOKENS.length) return false;
    }
    return true;
  }

  function untokenise(code) {
    function needSpaceBetween(lastch, ch) {
      var chAlphaNum="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$0123456789";
      return (lastch>=LEX_OPERATOR_START || ch>=LEX_OPERATOR_START) &&
         (lastch>=LEX_OPERATOR_START || chAlphaNum.includes(String.fromCharCode(lastch))) &&
         (ch>=LEX_OPERATOR_START || chAlphaNum.includes(String.fromCharCode(ch)));
    }
    var resultCode = "";
    var lastCh = 0;
    for (var i=0;i<code.length;i++) {
      var ch = code.charCodeAt(i);
      if (needSpaceBetween(lastCh, ch))
        resultCode += " ";
      if (ch>=LEX_OPERATOR_START) {
        if (ch==LEX_RAW_STRING8) { // decode raw strings
          let len = code.charCodeAt(i+1);
          resultCode += Espruino.Core.Utils.toJSONishString(code.substring(i+2, i+2+len));
          i+=1+len;
        } else if (ch==LEX_RAW_STRING16) {
          let len = code.charCodeAt(i+1) | (code.charCodeAt(i+2)<<8);
          resultCode += Espruino.Core.Utils.toJSONishString(code.substring(i+3, i+3+len));
          i+=2+len;
        } else if (ch<LEX_OPERATOR_START+TOKENS.length) // decoded other tokens
          resultCode += TOKENS[ch-LEX_OPERATOR_START];
        else {
          console.warn("Unexpected pretokenised string code:", ch);
          resultCode += code[i];
        }
      } else resultCode += code[i];
      lastCh = ch;
    }
    return resultCode;
  }

  Espruino.Plugins.Pretokenise = {
    init : init,
    sortOrder : 100, // after most plugins, before saveOnSend
    isTokenised : isTokenised, // could the given data be tokenised JS?
    untokenise : untokenise, // fn(code) convert a file containing tokens back into strings
    tokenise : tokenise // fn(code) convert a file containing tokens back into strings
  };
}());
