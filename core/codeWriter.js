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
      subSection: "Uploading",
      name : "Reset before Send",
      description : "Reset Espruino before sending code from the editor pane?",
      type : "boolean",
      defaultValue : true
    });
    Espruino.Core.Config.add("STORE_LINE_NUMBERS", {
      section : "Communications",
      subSection: "Code Transforms",
      name : "Store line numbers",
      description : "Should Espruino store line numbers for each function? This uses one extra variable per function, but allows you to get source code debugging in the Web IDE",
      type : "boolean",
      defaultValue : true
    });
    Espruino.Core.Config.add("SAVE_ON_SEND", {
      section : "Communications",
      subSection: "Storage",
      name : "Save on Send",
      descriptionHTML : 'How should code be uploaded? See <a href="http://www.espruino.com/Saving" target="_blank">espruino.com/Saving</a> for more information.<br>'+
                        "<b>NOTE:</b> Avoid 'Direct to flash, even after <code>reset()</code>' for normal development - it can make it hard to recover if your code crashes the device.",
      type : {
    // -1: is used by the app loader to signify that we want the code as-is (app loader adds write statements). Allows pretokenise to correctly check if we're writing to RAM or not
        0: "To RAM (default) - execute code while uploading. Use 'save()' to save a RAM image to Flash",
        1: "Direct to Flash (execute code at boot)",
        2: "Direct to Flash (execute code at boot, even after 'reset()') - USE WITH CARE",
        3: "To Storage File (see 'File in Storage to send to')",
      },
      defaultValue : 0
    });
    Espruino.Core.Config.add("SAVE_STORAGE_FILE", {
      section : "Communications",
      subSection: "Storage",
      name : "Send to File in Storage",
      descriptionHTML : "If <code>Save on Send</code> is set to <code>To Storage File</code>, this is the name of the file to write to.",
      type : "string",
      defaultValue : "myapp"
    });
    Espruino.Core.Config.add("LOAD_STORAGE_FILE", {
      section : "Communications",
      subSection: "Storage",
      name : "Load after saving",
      descriptionHTML : "This applies only if saving to Flash (not RAM)",
      type : {
        0: "Don't load",
        1: "Load default application",
        2: "Load the Storage File just written to"
      },
      defaultValue : 2
    });
    Espruino.Core.Config.add("PACKET_UPLOAD", {
      section : "Communications",
      subSection: "Uploading",
      name : "Packet Upload",
      descriptionHTML : "Use packet-based file uploads for better performance (new). This works well on connections without flow control, and requires firmware 2v25 or later.",
      type : "boolean",
      defaultValue : false
    });
  }



  function getUploadState() {
    var ENV = Espruino.Core.Env.getData();

    var ul = {
      isFlashPersistent: Espruino.Config.SAVE_ON_SEND == 2,
      isStorageUpload: Espruino.Config.SAVE_ON_SEND == 3,
      isSDCardUpload: Espruino.Config.SAVE_ON_SEND == 4,
      isRAMUpload: Espruino.Config.SAVE_ON_SEND == 0,
      hasStorage: ENV && ENV.VERSION_MAJOR && ENV.VERSION_MINOR && (ENV.VERSION_MAJOR>1 || (ENV.VERSION_MAJOR==1 && ENV.VERSION_MINOR>=96)),
      hasPacketUpload: ENV && ENV.VERSION_MAJOR && ENV.VERSION_MINOR && (ENV.VERSION_MAJOR>2 || (ENV.VERSION_MAJOR==2 && ENV.VERSION_MINOR>=25))
    };
    ul.isFlashUpload = Espruino.Config.SAVE_ON_SEND == 1 || ul.isFlashPersistent || ul.isStorageUpload;
    if (ul.isStorageUpload || ul.isSDCardUpload)
      ul.filename = Espruino.Config.SAVE_STORAGE_FILE;
    else if (ul.isFlashUpload)
      ul.filename = ul.isFlashPersistent ? ".bootrst" : ".bootcde";
    return ul;
  }

  /* Get the command used to load the uploaded file */
  function getLoadCommand() {
    var ul = getUploadState();
    if (ul.isRAMUpload) return "";
    if (Espruino.Config.LOAD_STORAGE_FILE==2 && ul.isStorageUpload)
      return "\x10load("+Espruino.Core.Utils.toJSONishString(ul.filename)+")\n";
    else if (Espruino.Config.LOAD_STORAGE_FILE!=0)
      return "\x10load()\n";
    return "";
  }

  /** Convert code into the JS commands needed to upload that code */
  function getUploadCommands(code) {
    let ul = getUploadState();
    // convert any non-0..255 charcodes to UTF8 encoding
    code = Espruino.Core.Utils.asUTF8Bytes(code);
    // Depending on settings, choose how we package code for upload (see Espruino.Core.Send.SEND_MODE_* constants)

    if (!ul.isFlashUpload && !ul.isSDCardUpload) {
      // Just uploading to RAM
      /* hack around non-K&R code formatting that would have
      broken Espruino CLI's bracket counting */
      return reformatCodeForREPL(code);
    }

    var asJS = Espruino.Core.Utils.toJSONishString;
    const CHUNKSIZE = 1024;

     // Now create the commands to do the upload
    console.log("Uploading "+code.length+" bytes to flash");
    if (!ul.hasStorage) { // old style
      if (ul.isStorageUpload || ul.isSDCardUpload) {
        Espruino.Core.Notifications.error("You have pre-1v96 firmware - unable to upload to Storage");
        code = "";
      } else {
        Espruino.Core.Notifications.error("You have pre-1v96 firmware. Upload size is limited by available RAM");
        code = "E.setBootCode("+asJS(code)+(ul.isFlashPersistent?",true":"")+");";
      }
    } else if (ul.isSDCardUpload) {
      var newCode = [ `let _ul = E.openFile(${asJS(ul.filename)},"w");` ];
        var len = code.length;
      for (var i=0;i<len;i+=CHUNKSIZE)
        newCode.push(`_ul.write(${asJS(code.substr(i,CHUNKSIZE))});`);
      newCode.push(`_ul.close();delete _ul;`);
      code = "\x10"+newCode.join("\n\x10")+"\n";
    } else { // new style
      if (!ul.filename || ul.filename.length>28) {
        Espruino.Core.Notifications.error("Invalid Storage file name "+JSON.stringify(ul.filename));
        code = "";
      } else {
        var newCode = [];
        var len = code.length;
        newCode.push('require("Storage").write('+asJS(ul.filename)+','+asJS(code.substr(0,CHUNKSIZE))+',0,'+len+');');
        for (var i=CHUNKSIZE;i<len;i+=CHUNKSIZE)
          newCode.push('require("Storage").write('+asJS(ul.filename)+','+asJS(code.substr(i,CHUNKSIZE))+','+i+');');
        code = "\x10"+newCode.join("\n\x10")+"\n";
      }
    }
    return code;
  }


  function writeToEspruino(code, callback) {
    if (code === undefined) return; // it should already have errored

    function recoverAndCallback() {
      // give 5 seconds for sending with save and 2 seconds without save
      var count = Espruino.Config.SAVE_ON_SEND ? 50 : 20;
      setTimeout(function cb() {
        if (Espruino.Core.Terminal!==undefined &&
            !Espruino.Core.Terminal.getTerminalLine().startsWith(">")) {
          count--;
          if (count>0) {
            setTimeout(cb, 100);
          } else {
            Espruino.Core.Notifications.error("Prompt not detected - upload failed. Trying to recover...");
            Espruino.Core.Serial.write("\x03\x03echo(1)\n", false, callback);
          }
        } else {
          callback();
        }
      }, 100);
    }

    // We want to make sure we've got a prompt before sending. If not,
    // this will issue a Ctrl+C
    Espruino.Core.Utils.getEspruinoPrompt(function() {
      var ul = getUploadState();
      if (Espruino.Config.PACKET_UPLOAD && !ul.hasPacketUpload) {
        Espruino.Core.Notifications.warning("Your firmware doesn't support packet uploads - please update to 2v25 or later");
      }
      if (Espruino.Config.PACKET_UPLOAD && ul.hasPacketUpload) {
        if (ul.isStorageUpload || ul.isSDCardUpload || ul.isFlashUpload) {
          Espruino.Core.Status.setStatus("Sending...", 1);
          let lastProgress = 0;
          var options = {
            fs : ul.isSDCardUpload ? 1 : 0,
            progress : (byteNo,byteCount) => {
              Espruino.Core.Status.incrementProgress((byteNo-lastProgress) / byteCount);
              lastProgress = byteNo;
            }
          };

          return Espruino.Core.Serial.connection.espruinoSendFile(ul.filename, code, options).then(function() {
            Espruino.Core.Status.setStatus("Upload Complete");
            var loadCmd = getLoadCommand();
            if (loadCmd != "") {
              Espruino.Core.Serial.write(loadCmd, true, recoverAndCallback);
            } else
              callback(); // just return now

          }, function(err) {
            Espruino.Core.Notifications.error("Error uploading file: "+err);
            callback();
          });
        }
      }

      /* If needed, convert code to upload to a set of JS commands
      which will upload the code into Espruino's flash/etc */
      code = getUploadCommands(code) + getLoadCommand();

      // Make sure code ends in 2 newlines
      while (code[code.length-2]!="\n" || code[code.length-1]!="\n")
        code += "\n";

      // By sending an empty print, we remove the Espruino '>' prompt
      // which then allows us to see if upload has finished
      code = "\x10print()\n"+code;
      // If we're supposed to reset Espruino before sending...
      if (Espruino.Config.RESET_BEFORE_SEND) {
        // reset Espruino
        code = "\x10reset();\n"+code;
      }

      //console.log("Sending... "+data);
      Espruino.Core.Serial.write(code, true, recoverAndCallback);
    });
  }

  /**
   * Parse and fix issues like `if (false)\n foo` in the root scope
   * @param {string} code
   * @returns {string | undefined}
   */
  function reformatCodeForREPL(code) {
    var APPLY_LINE_NUMBERS = false;
    var lineNumberOffset = 0;
    var ENV = Espruino.Core.Env.getData();
    if (ENV && ENV.VERSION_MAJOR && ENV.VERSION_MINOR) {
      if (ENV.VERSION_MAJOR>1 ||
          ENV.VERSION_MINOR>=81.086) {
        if (Espruino.Config.STORE_LINE_NUMBERS)
          APPLY_LINE_NUMBERS = true;
      }
    }
    /* There's only any point writing line numbers when we're saving to RAM. Otherwise we just
    end up applying line numbers to require("Storage").write lines. see https://github.com/espruino/EspruinoTools/pull/179 */
    if (Espruino.Config.SAVE_ON_SEND != 0) {
      APPLY_LINE_NUMBERS = false;
    }
    // Turn cr/lf into just lf (eg. windows -> unix)
    code = code.replace(/\r\n/g,"\n");
    // First off, try and fix funky characters
    for (let i=0;i<code.length;i++) {
      var ch = code.charCodeAt(i);
      if ((ch<32 || ch>255) && ch!=9/*Tab*/ && ch!=10/*LF*/ && ch!=13/*CR*/) {
        console.warn("codewriter> Unexpected character code "+ch+" at position "+i+". Replacing with ?");
        code = code.substr(0,i)+"?"+code.substr(i+1);
      }
    }

    /* Search for lines added to the start of the code by the module handler.
    Ideally there would be a better way of doing this so line numbers stayed correct,
    but this hack works for now. Fixes EspruinoWebIDE#140 */
    if (APPLY_LINE_NUMBERS) {
      var l = code.split("\n");
      let i = 0;
      while (l[i] && (l[i].substr(0,8)=="Modules." ||
                      l[i].substr(0,8)=="setTime(")) i++;
      lineNumberOffset = -i;
    }

    var resultCode = "\x10"; // 0x10 = echo off for line
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
     *   `try { } \n catch \n () \n {}`
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
    var curlyBrackets = 0;
    var statementBeforeBrackets = false;
    var statement = false;
    var varDeclaration = false;
    var lastIdx = 0;
    var lastTok = {str:""};
    var tok = lex.next();
    while (tok!==undefined) {
      var previousString = code.substring(lastIdx, tok.startIdx);
      var tokenString = code.substring(tok.startIdx, tok.endIdx);
      //console.log("codewriter> prev "+JSON.stringify(previousString)+"   next "+tokenString);

      /* Inserting Alt-Enter newline, which adds newline without trying
      to execute */
      if (brackets>0 || // we have brackets - sending the alt-enter special newline means Espruino doesn't have to do a search itself - faster.
          statement || // statement was before brackets - expecting something else
          statementBeforeBrackets ||  // we have an 'if'/etc
          varDeclaration || // variable declaration then newline
          tok.str=="," || // comma on newline - there was probably something before
          tok.str=="." || // dot on newline - there was probably something before
          tok.str=="+" || tok.str=="-" || // +/- on newline - there was probably something before
          tok.str=="=" || // equals on newline - there was probably something before
          tok.str=="else" || // else on newline
          lastTok.str=="else" || // else befgore newline
          tok.str=="catch" || // catch on newline - part of try..catch
          lastTok.str=="catch"
        ) {
        //console.log("codewriter> Possible"+JSON.stringify(previousString));
        previousString = previousString.replace(/\n/g, "\x1B\x0A");
      }

      var previousBrackets = brackets;
      if (tok.str=="(" || tok.str=="{" || tok.str=="[") brackets++;
      if (tok.str=="{") curlyBrackets++;
      if (tok.str==")" || tok.str=="}" || tok.str=="]") brackets--;
      if (tok.str=="}") curlyBrackets--;

      if (brackets==0) {
        if (tok.str=="for" || tok.str=="if" || tok.str=="while" || tok.str=="function" || tok.str=="throw") {
          statementBeforeBrackets = true;
          varDeclaration = false;
        } else if (tok.str=="var") {
          varDeclaration = true;
        } else if (tok.type=="ID" && lastTok.str=="function") {
          statementBeforeBrackets = true;
        } else if (tok.str=="try" || tok.str=="catch") {
          statementBeforeBrackets = true;
        } else if (tok.str==")" && statementBeforeBrackets) {
          statementBeforeBrackets = false;
          statement = true;
        } else if (["=","^","&&","||","+","+=","-","-=","*","*=","/","/=","%","%=","&","&=","|","|="].indexOf(tok.str)>=0) {
          statement = true;
        } else {
          if (tok.str==";") varDeclaration = false;
          statement = false;
          statementBeforeBrackets = false;
        }
      }
      /* If we're at root scope and had whitespace/comments between code,
      remove it all and replace it with a single newline and a
      0x10 (echo off for line) character. However DON'T do this if we had
      an alt-enter in the line, as it was there to stop us executing
      prematurely */
      if (previousBrackets==0 &&
          previousString.indexOf("\n")>=0 &&
          previousString.indexOf("\x1B\x0A")<0) {
        previousString = "\n\x10";//FIXME
        // Apply line numbers to each new line sent, to aid debugger
        if (APPLY_LINE_NUMBERS && tok.lineNumber && (tok.lineNumber+lineNumberOffset)>0) {
          // Esc [ 1234 d
          // This is the 'set line number' command that we're abusing :)
          previousString += "\x1B\x5B"+(tok.lineNumber+lineNumberOffset)+"d";
        }
      }

      // add our stuff back together
      resultCode += previousString+tokenString;
      // next
      lastIdx = tok.endIdx;
      lastTok = tok;
      tok = lex.next();
    }
    //console.log(resultCode);
    if (brackets>0) {
      Espruino.Core.Notifications.error("You have more open brackets than close brackets. Please see the hints in the Editor window.");
      return undefined;
    }
    if (brackets<0) {
      Espruino.Core.Notifications.error("You have more close brackets than open brackets. Please see the hints in the Editor window.");
      return undefined;
    }
    return resultCode;
  }

  Espruino.Core.CodeWriter = {
    init : init,
    writeToEspruino : writeToEspruino, // call this to send to Espruino
    reformatCodeForREPL : reformatCodeForREPL  // Parse and fix issues like `if (false)\n foo` in the root scope
  };
}());
