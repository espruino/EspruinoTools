/**
 Copyright 2014 Gordon Williams (gw@pur3.co.uk)

 This Source Code is subject to the terms of the Mozilla Public
 License, v2.0. If a copy of the MPL was not distributed with this
 file, You can obtain one at http://mozilla.org/MPL/2.0/.
 
 ------------------------------------------------------------------
  Utilities
 ------------------------------------------------------------------
**/
"use strict";
(function(){
  
  function init() {
    
  }
  
  function isWindows() {
    return navigator.userAgent.indexOf("Windows")>=0;
  }
  
  function getChromeVersion(){
    return parseInt(window.navigator.appVersion.match(/Chrome\/(.*?) /)[1].split(".")[0]);
  }
  
  function escapeHTML(text, escapeSpaces) 
  {
    escapeSpaces = typeof escapeSpaces !== 'undefined' ? escapeSpaces : true;

    var chr = { '"': '&quot;', '&': '&amp;', '<': '&lt;', '>': '&gt;', ' ' : (escapeSpaces ? '&nbsp;' : ' ') };
    
    return text.toString().replace(/[\"&<> ]/g, function (a) { return chr[a]; });    
  }
  
  function getSubString(str, from, len) {
    if (len == undefined) {
      return str.substr(from, len);
    } else {
      var s = str.substr(from, len);
      while (s.length < len) s+=" ";
      return s;
    }
  };  
  
  /** Get a Lexer to parse JavaScript - this is really very nasty right now and it doesn't lex even remotely properly.
   * It'll return {type:"type", str:"chars that were parsed", value:"string", startIdx: Index in string of the start, endIdx: Index in string of the end}, until EOF when it returns undefined */
  function getLexer(str) {
    // Nasty lexer - no comments/etc
    var chAlpha="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$";
    var chNum="0123456789";
    var chAlphaNum = chAlpha+chNum;
    var chWhiteSpace=" \t\n\r";
    var chQuotes = "\"'";
    var ch;
    var idx = 0;
    var lineNumber = 1;
    var nextCh = function() { 
      ch = str[idx++]; 
      if (ch=="\n") lineNumber++;
    };
    nextCh();
    var isIn = function(s,c) { return s.indexOf(c)>=0; } ;
    var nextToken = function() {
      while (isIn(chWhiteSpace,ch)) {        
        nextCh();
      }
      if (ch==undefined) return undefined; 
      if (ch=="/") {
        nextCh();
        if (ch=="/") {
          // single line comment
          while (ch!==undefined && ch!="\n") nextCh();
          return nextToken();
        } else if (ch=="*") {
          nextCh();
          var last = ch;
          nextCh();
          // multiline comment          
          while (ch!==undefined && !(last=="*" && ch=="/")) {
            last = ch;
            nextCh();
          }
          nextCh();
          return nextToken();
        }
        return {type:"CHAR", str:"/", value:"/", startIdx:idx-2, endIdx:idx-1, lineNumber:lineNumber};
      }
      var s = "";        
      var type, value;
      var startIdx = idx-1;
      if (isIn(chAlpha,ch)) { // ID
        type = "ID";
        do {
          s+=ch;
          nextCh();
        } while (isIn(chAlphaNum,ch));
      } else if (isIn(chNum,ch)) { // NUMBER
        type = "NUMBER";
        do {
          s+=ch;
          nextCh();
        } while (isIn(chNum,ch) || ch==".")
      } else if (isIn(chQuotes,ch)) { // STRING
        type = "STRING";
        var q = ch;
        value = "";
        s+=ch;
        nextCh();
        while (ch!==undefined && ch!=q) {
          s+=ch;
          if (ch=="\\") {
            nextCh();
            // FIXME: handle hex/etc correctly here
          }
          value += ch;
          nextCh();
        };        
        if (ch!==undefined) s+=ch;
        nextCh();
      } else {
        type = "CHAR";
        s+=ch;
        nextCh();
      }
      if (value===undefined) value=s;
      return {type:type, str:s, value:value, startIdx:startIdx, endIdx:idx-1, lineNumber:lineNumber};
    };
    
    return {
      next : nextToken
    };
  };
  
  /** Count brackets in a string - will be 0 if all are closed */ 
  function countBrackets(str) {
    var lex = getLexer(str);
    var brackets = 0;
    var tok = lex.next();
    while (tok!==undefined) {
      if (tok.str=="(" || tok.str=="{" || tok.str=="[") brackets++;      
      if (tok.str==")" || tok.str=="}" || tok.str=="]") brackets--;
      tok = lex.next();
    }
    return brackets;
  }
  
  /** Try and get a prompt from Espruino - if we don't see one, issue Ctrl-C
   * and hope it comes back. Calls callback with first argument true if it
     had to Ctrl-C out */
  function getEspruinoPrompt(callback) {
    if (Espruino.Core.Terminal!==undefined &&
        Espruino.Core.Terminal.getTerminalLine()==">") {
      console.log("Found a prompt... great!");
      return callback();
    }

    var  receivedData = "";
    var prevReader = Espruino.Core.Serial.startListening(function (readData) {
      var bufView = new Uint8Array(readData);
      for(var i = 0; i < bufView.length; i++) {
        receivedData += String.fromCharCode(bufView[i]);
      }
      if (receivedData[receivedData.length-1] == ">") {
        console.log("Received a prompt after sending newline... good!");
        clearTimeout(timeout);
        nextStep();         
      }        
    });      
    // timeout in case something goes wrong...
    var hadToBreak = false;
    var timeout = setTimeout(function() {          
      console.log("Got "+JSON.stringify(receivedData));          
      // if we haven't had the prompt displayed for us, Ctrl-C to break out of what we had
      console.log("No Prompt found, got "+JSON.stringify(receivedData[receivedData.length-1])+" - issuing Ctrl-C to try and break out");
      Espruino.Core.Serial.write('\x03');
      hadToBreak = true;
      nextStep();
    },500);        
    // when we're done...
    var nextStep = function() {
      // send data to console anyway...
      prevReader(receivedData);
      receivedData = "";
      // start the previous reader listening again
      Espruino.Core.Serial.startListening(prevReader);          
      // call our callback
      if (callback) callback(hadToBreak);
    };
    // send a newline, and we hope we'll see '=undefined\r\n>'
    Espruino.Core.Serial.write('\n');      
  };  

  /** Return the value of executing an expression on the board */
  function executeExpression(expressionToExecute, callback) {
    var receivedData = "";
    var hadDataSinceTimeout = false;
    
    function getProcessInfo(expressionToExecute, callback) {      
      var prevReader = Espruino.Core.Serial.startListening(function (readData) {
        var bufView = new Uint8Array(readData);
        for(var i = 0; i < bufView.length; i++) {
          receivedData += String.fromCharCode(bufView[i]);
        }
        // check if we got what we wanted
        var startProcess = receivedData.indexOf("< <<");
        var endProcess = receivedData.indexOf(">> >", startProcess);
        if(startProcess >= 0 && endProcess > 0){
          // All good - get the data!
          var result = receivedData.substring(startProcess + 4,endProcess);       
          console.log("Got "+JSON.stringify(receivedData)); 
          // strip out the text we found
          receivedData = receivedData.substr(0,startProcess) + receivedData.substr(endProcess+4);
          // try and strip out the echo 0 too...
          receivedData = receivedData.replace("echo(0);\r\n\r\n=undefined\r\n>","");       
          // Now stop time timeout
          clearInterval(timeout);
          // Do the next stuff
          nextStep(result);
        } else if (startProcess >= 0) {
          // we got some data - so keep waiting...
          hadDataSinceTimeout = true;
        }
      });
      
      // when we're done...
      var nextStep = function(result) {
        // start the previous reader listing again
        Espruino.Core.Serial.startListening(prevReader);          
        // forward the original text to the previous reader
        prevReader(receivedData);
        // run the callback
        callback(result);
      };

      // Don't Ctrl-C, as we've already got ourselves a prompt with Espruino.Core.Utils.getEspruinoPrompt
      Espruino.Core.Serial.write('echo(0);\nconsole.log("<","<<",JSON.stringify('+expressionToExecute+'),">>",">");echo(1);\n');

      var maxTimeout = 20; // 10 secs
      var timeoutCnt = 0;
      var timeout = setInterval(function onTimeout(){
        timeoutCnt++;
        // if we're still getting data, keep waiting for up to 10 secs
        if (hadDataSinceTimeout && timeoutCnt<maxTimeout) {
          hadDataSinceTimeout = false;
        } else if (timeoutCnt>2) {
          // No data in 1 second
          // OR we keep getting data for > maxTimeout seconds
          clearInterval(timeout);
          console.warn("No result found - just got "+JSON.stringify(receivedData));          
          nextStep(undefined);        
        }        
      }, 500);   
    }    
   
    if(Espruino.Core.Serial.isConnected()){
      Espruino.Core.Utils.getEspruinoPrompt(function() {
        getProcessInfo(expressionToExecute, callback);
      });
    } else console.error("executeExpression called when not connected!");
  };
  
  function versionToFloat(version) {
    return parseFloat(version.trim().replace("v","."));
  };    
  
  /** Make an HTML table out of a simple key/value object */
  function htmlTable(obj) {
    var html = '<table>';
    for (var key in obj) {
      html += '<tr><th>'+Espruino.Core.Utils.escapeHTML(key)+'</th><td>'+Espruino.Core.Utils.escapeHTML(obj[key])+'</td></tr>';
    }
    return html + '</table>';
  }
  
  function markdownToHTML(markdown) {
    var html = markdown;
    //console.log(JSON.stringify(html));
    html = html.replace(/\n\s*\n/g, "\n<br/><br/>\n"); // newlines
    html = html.replace(/\*\*(.*)\*\*/g, "<strong>$1</strong>"); // bold
    html = html.replace(/```(.*)```/g, "<span class=\"code\">$1</span>"); // code
    //console.log(JSON.stringify(html));
    return html;
  };  
  
  /// Gets a URL, and returns callback(data) or callback(undefined) on error
  function getURL(url, callback) {
    Espruino.callProcessor("getURL", { url : url, data : undefined }, function(result) {
      if (result.data!==undefined) {
        callback(result.data);
      } else {
        if (typeof process === 'undefined') {
          // Web browser
          $.get( url, function(d) {
            callback(d);
          }, "text").error(function(xhr,status,err) {
            console.error(err);
            callback(undefined);
          });
        } else { 
          // Node.js
          if (url.substr(0,4)=="http") {
            require("http").get(url, function(res) { 
              var data = ""; 
              res.on("data", function(d) { data += d; });
              res.on("end", function() { 
                callback(data); 
              });
            }).on('error', function(err) {
              console.error(err);
              callback(undefined);    
            });
          } else {
            require("fs").readFile(url, function(err, d) {
              if (err) {
                console.error(err);
                callback(undefined);
              } else
                callback(d.toString());
            });
          }
        }
      }
    });
  }

  /// Gets a URL as JSON, and returns callback(data) or callback(undefined) on error
  function getJSONURL(url, callback) {
    getURL(url, function(d) {
      if (!d) return callback(d);      
      var j;
      try { j=JSON.parse(d); } catch (e) { console.error("Unable to parse JSON",d); }
      callback(j);
    });
  }
  
  function isURL(text) {
    return (new RegExp( '(http|https)://' )).test(text);
  }

  /* Are we served from a secure location so we're
   forced to use a secure get? */
  function needsHTTPS() {
    if (typeof window==="undefined" || !window.location) return false;
    return window.location.protocol=="https:";
  }

  
  Espruino.Core.Utils = {
      init : init,
      isWindows : isWindows,   
      getChromeVersion : getChromeVersion,
      escapeHTML : escapeHTML,
      getSubString : getSubString,
      getLexer : getLexer,
      countBrackets : countBrackets,
      getEspruinoPrompt : getEspruinoPrompt,
      executeExpression : executeExpression,
      versionToFloat : versionToFloat,
      htmlTable : htmlTable,
      markdownToHTML : markdownToHTML,
      getURL : getURL,
      getJSONURL : getJSONURL,
      isURL : isURL,
      needsHTTPS : needsHTTPS
  };
}());
