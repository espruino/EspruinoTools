/**
 Copyright 2014 Gordon Williams (gw@pur3.co.uk)

 This Source Code is subject to the terms of the Mozilla Public
 License, v2.0. If a copy of the MPL was not distributed with this
 file, You can obtain one at http://mozilla.org/MPL/2.0/.
 
 ----------------------------------------------------------49--------
  An Compiler that converts any bit of JavaScript tagged with
  "compiled" into native code.
  
  function foo(a,b) {
    "compiled";
    return a+b;
  }
 ------------------------------------------------------------------
**/
"use strict";
(function(){
  
  function init() {
    Espruino.Core.Config.add("COMPILATION", {
      section : "Communications",
      name : "JavaScript Compiler",
      descriptionHTML : 'Compile JavaScript functions prefixed with &quot;compiled&quot; into Native code. (<a href="http://www.espruino.com/Compilation" target="_blank">More Info</a>)',
      type : "boolean",
      defaultValue : true
    });
    Espruino.Core.Config.add("COMPILATION_URL", {
      section : "Communications",
      name : "JavaScript Compiler URL",
      description : "When JavaScript Compilation is enabled, this is the URL of the JavaScript compiler",
      type : "string",
      defaultValue : "http://www.espruino.com:32766"
    });

    // When code is sent to Espruino, search it for modules and add extra code required to load them 
    Espruino.addProcessor("transformForEspruino", function(code, callback) {
      compileCode(code, callback);
    });
  }

  function compileCode(code, callback) {
    if (!Espruino.Config.COMPILATION)
      return callback(code);

    var board = Espruino.Core.Env.getBoardData();
    if (board == undefined) {
      Espruino.Core.Notifications.error("Current board not known - please connect to the Espruino board first");
      return callback(code);
    }

    var tasks = 0;
    try {
      var ast = acorn.parse(code, { ecmaVersion : 6 });
      var nodes = [];
      ast.body.forEach(function(node) {
        if (node.type=="FunctionDeclaration") {
          if (node.body.type=="BlockStatement" &&
              node.body.body.length>0 &&
              node.body.body[0].type=="ExpressionStatement" &&
              node.body.body[0].expression.type=="Literal" && 
              node.body.body[0].expression.value=="compiled") {
            if (typeof board.EXPORTS != "object") {
              Espruino.Core.Notifications.error("Compiler not active as no process.env.EXPORTS available.<br/>Is your firmware up to date?");
              return callback(code);
            }
            nodes.push(node);
          }
        }
      });
      nodes.forEach(function (node) {        
        tasks++;
        $.post(Espruino.Config.COMPILATION_URL, {
              js : code.substring(node.start, node.end),
              exports : JSON.stringify(board.EXPORTS)
            }, function(newCode) {
                  if (newCode) {                
                    //console.log(asm);
                    //console.log(node);
                    code = code.substr(0,node.start) + newCode + code.substr(node.end);
                    var offs = newCode.length - (node.end-node.start); // offset for future code snippets
                    for (var i in nodes)
                      if (nodes[i].start > node.start) {
                        nodes[i].start += offs;
                        nodes[i].end += offs;
                      } 
                  }
                  tasks--;
                  if (tasks==0)
                    callback(code);                  
            }).fail(function() {
              Espruino.Core.Notifications.error( "Error contacting server. Unable to compile code right now." );
              tasks--;
              if (tasks==0) callback(code);
            });
      });

    } catch (err) {
      console.log(err);
      Espruino.Core.Notifications.error("Acorn parse for plugins/compiler.js failed.<br/>Check the editor window for syntax errors");
    }
    if (tasks==0)
      callback(code);
  }
  
  Espruino.Plugins.Compiler = {
    init : init,
  };
}());

