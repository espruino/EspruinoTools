/**
 Copyright 2014 Gordon Williams (gw@pur3.co.uk)

 This Source Code is subject to the terms of the Mozilla Public
 License, v2.0. If a copy of the MPL was not distributed with this
 file, You can obtain one at http://mozilla.org/MPL/2.0/.
 
 ------------------------------------------------------------------
  The plugin that actually writes code out to Espruino
 ------------------------------------------------------------------
**/
"use strict";
(function(){
  
  function init() {
    Espruino.Core.Config.add("RESET_BEFORE_SEND", {
      section : "Communications",
      name : "Reset before Send",
      description : "Reset Espruino before sending code from the editor pane?",
      type : "boolean",
      defaultValue : true
    });
    Espruino.Core.Config.add("STORE_LINE_NUMBERS", {
      section : "Communications",
      name : "Store line numbers",
      description : "Should Espruino store line numbers for each function? This uses one extra variable per function, but allows you to get source code debugging in the Web IDE",
      type : "boolean",
      defaultValue : true
    });
  }

  function writeToEspruino(code, callback) {  
    code = reformatCode(code);
    if (code === undefined) return; // it should already have errored
    
    // We want to make sure we've got a prompt before sending. If not,
    // this will issue a Ctrl+C
    Espruino.Core.Utils.getEspruinoPrompt(function() {
      // turn off ech around the code
      code = "echo(0);\n" + code + "\necho(1);\n";

      // If we're supposed to reset Espruino before sending...
      if (Espruino.Config.RESET_BEFORE_SEND) {
        code = "reset();\n"+code;
      } 

      //console.log("Sending... "+data);
      Espruino.Core.Serial.write(code, true, function() {
        var count = 20;
        setTimeout(function cb() {
          if (Espruino.Core.Terminal!==undefined && 
              Espruino.Core.Terminal.getTerminalLine()!=">") {
            count--;
            if (count>0) {
              setTimeout(cb, 100);
            } else {
              Espruino.Core.Terminal.outputDataHandler("ERROR: Prompt not detected - upload failed. Trying to recover...\n");
              Espruino.Core.Serial.write("\x03echo(1)\n", false, callback);
            }
          } else {
            if (callback) callback();
          }
        }, 100);
      });
    });
  };
  
  /// Parse and fix issues like `if (false)\n foo` in the root scope
  function reformatCode(code) {      
     var APPLY_LINE_MUMBERS = false;
     var ENV = Espruino.Core.Env.getData(); 
     if (ENV) {
       if (ENV.VERSION_MAJOR && ENV.VERSION_MINOR) {
         if (ENV.VERSION_MAJOR>1 ||
             ENV.VERSION_MINOR>=81.086) {
           if (Espruino.Config.STORE_LINE_NUMBERS)
             APPLY_LINE_MUMBERS = true;
         }
       }
     }
    
    // First off, try and fix funky characters
    for (var i=0;i<code.length;i++) {
      var ch = code.charCodeAt(i);
      if ((ch<32 || ch>255) && ch!=9/*Tab*/ && ch!=10/*LF*/ && ch!=13/*CR*/) {
        console.warn("Funky character code "+ch+" at position "+i+". Replacing with ?");
        code = code.substr(0,i)+"?"+code.substr(i+1);
      }
    }     

    var resultCode = "";
    /** we're looking for:
     *   `a = \n b`
     *   `for (.....) \n X`
     *   `if (.....) \n X`
     *   `if (.....) { } \n else foo`   
     *   `while (.....) \n X`
     *   `do \n X`
     *   `function (.....) \n X`   
     *   `function N(.....) \n X`
     *   `var a \n , b`    `var a = 0 \n, b`
     *   `var a, \n b`     `var a = 0, \n b`
     *   `a \n . b`
     *   `foo() \n . b`
     *   
     *   These are divided into two groups - where there are brackets
     *   after the keyword (statementBeforeBrackets) and where there aren't
     *   (statement)
     *   
     *   We fix them by replacing \n with what you get when you press
     *   Alt+Enter (Ctrl + LF). This tells Espruino that it's a newline
     *   but NOT to execute. 
     */ 
    var lex = Espruino.Core.Utils.getLexer(code);
    var brackets = 0;
    var statementBeforeBrackets = false;
    var statement = false;
    var varDeclaration = false;
    var lastIdx = 0;
    var lastTok;
    var tok = lex.next();
    while (tok!==undefined) {
      var previousString = code.substring(lastIdx, tok.startIdx);
      var tokenString = code.substring(tok.startIdx, tok.endIdx);
      //console.log("prev "+JSON.stringify(previousString)+"   next "+tokenString);
      
      if (brackets>0 || // we have brackets - sending the special newline means Espruino doesn't have to do a search itself - faster. 
          statement || // statement was before brackets - expecting something else 
          statementBeforeBrackets ||  // we have an 'if'/etc
          varDeclaration || // variable declaration then newline
          tok.str=="," || // comma on newline - there was probably something before
          tok.str=="." || // dot on newline - there was probably something before
          tok.str=="else" // else on newline
        ) {
        //console.log("Possible"+JSON.stringify(previousString));
        previousString = previousString.replace(/\n/g, "\x1B\x0A");
      }

      if (tok.str=="(" || tok.str=="{" || tok.str=="[") brackets++;      
      if (tok.str==")" || tok.str=="}" || tok.str=="]") brackets--;      
      
      if (brackets==0) {
        if (tok.str=="for" || tok.str=="if" || tok.str=="while" || tok.str=="function" || tok.str=="throw") {
          statementBeforeBrackets = true;
          varDeclaration = false;
        } else if (tok.str=="var") {
          varDeclaration = true;
        } else if (tok.type=="ID" && lastTok!==undefined && lastTok.str=="function") {
          statementBeforeBrackets = true;
        } else if (tok.str==")" && statementBeforeBrackets) {            
          statementBeforeBrackets = false;
          statement = true;
        } else if (tok.str=="=" || tok.str=="do") {
          statement = true;
        } else {            
          if (tok.str==";") varDeclaration = false;
          statement = false;
          statementBeforeBrackets = false;
        }
        
        /* For functions defined at the global scope, we want to shove
         * an escape code before them that tells Espruino what their
         * line number is */
        if (APPLY_LINE_MUMBERS && tok.str=="function" && tok.lineNumber) {
          // Esc [ 1234 d
          // This is the 'set line number' command that we're abusing :)
          previousString += "\x1B\x5B"+tok.lineNumber+"d";
        }
      }
      
      // add our stuff back together
      resultCode += previousString + tokenString;
      // next
      lastIdx = tok.endIdx;
      lastTok = tok;
      tok = lex.next();               
    }
    //console.log(resultCode);
    if (brackets>0) {
      Espruino.Core.Notifications.error("You haven more open brackets than close brackets. Please see the hints in the Editor window.");
      return undefined;
    }
    if (brackets<0) {
      Espruino.Core.Notifications.error("You haven more close brackets than open brackets. Please see the hints in the Editor window.");
      return undefined;
    }
    return resultCode;
  };
  
  Espruino.Core.CodeWriter = {
    init : init,
    writeToEspruino : writeToEspruino,
  };
}());
