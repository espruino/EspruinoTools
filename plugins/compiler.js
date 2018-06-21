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
      defaultValue : "https://www.espruino.com/service/compiler"
    });
    if (Espruino.Config.COMPILATION_URL == "http://www.espruino.com:32766")
      Espruino.Config.COMPILATION_URL = "https://www.espruino.com/service/compiler";

    // When code is sent to Espruino, search it for compiled js/inline c
    Espruino.addProcessor("transformForEspruino", function(code, callback) {
      compileCode(code, "", callback);
    });
    // When a module is sent to Espruino...
    Espruino.addProcessor("transformModuleForEspruino", function(module, callback) {
      compileCode(module.code, " in "+module.name, function(code) {
        module.code = code;
        callback(module);
      });
    });
  }

  function compileCode(code, description, callback) {
    if (!Espruino.Config.COMPILATION)
      return callback(code);

    var board = Espruino.Core.Env.getBoardData();
    var tasks = 0;
    try {
      var ast = acorn.parse(code, { ecmaVersion : 6 });
      var tasks = [];
      // function xyz() { "compiled" ... }
      ast.body.forEach(function(node) {
        if (node.type=="FunctionDeclaration") {
          if (node.body.type=="BlockStatement" &&
              node.body.body.length>0 &&
              node.body.body[0].type=="ExpressionStatement" &&
              node.body.body[0].expression.type=="Literal" &&
              node.body.body[0].expression.value=="compiled") {
            tasks.push({
              type:"js",
              node:node,
              source: code.substring(node.start, node.end),
            });
          }
        }
        // 'var xyz = E.compiledC(`templateliteral`)'
        if (node.type=="VariableDeclaration" && node.declarations.length==1) {
          var d = node.declarations[0];
          if (d.type=="VariableDeclarator" &&
              d.init &&
              d.init.type=="CallExpression" &&
              d.init.callee.type=="MemberExpression" &&
              d.init.callee.object.name=="E" &&
              d.init.callee.property.name=="compiledC" &&
              d.init.arguments &&
              d.init.arguments.length==1 &&
              d.init.arguments[0].type=="TemplateLiteral") {
                tasks.push({
                  type:"c",
                  node:d.init,
                  source: d.init.arguments[0].quasis[0].value.raw,
                });
          }
        }
      });
      if (tasks.length) {
        if (!board ||
            typeof board.EXPORTS != "object" &&
            typeof board.EXPTR != "number"  ) {
          Espruino.Core.Notifications.error("Compiler not active as no process.env.EXPORTS/EXPTR available.<br/>Is your board supported and firmware up to date?");
          return callback(code);
        }
      }

      /* Replace this node with the given text, and
      update node start/end positions of other nodes
      we're interested in */
      function replaceNode(node, newCode) {
        code = code.substr(0,node.start) + newCode + code.substr(node.end);
        var offs = newCode.length - (node.end-node.start); // offset for future code snippets
        for (var i in tasks)
          if (tasks[i].node.start > node.start) {
            tasks[i].node.start += offs;
            tasks[i].node.end += offs;
          }
      }
      var taskCount = 0;
      tasks.forEach(function (task) {
        taskCount++;
        var compileData = {
          board : board.BOARD,
          version : board.VERSION,
          git : board.GIT_COMMIT,
        };
        if (task.type=="js") {
          compileData.js = task.source;
        } else if (task.type == "c") {
          compileData.c = task.source;
        } else throw new Error("Unknown Node type");
        if (board.EXPORTS)
          compileData.exports = JSON.stringify(board.EXPORTS);
        if (board.EXPTR)
          compileData.exptr = JSON.stringify(board.EXPTR);

        $.post(Espruino.Config.COMPILATION_URL, compileData, function(newCode) {
          if (newCode) {
            replaceNode(task.node, newCode);
          }
          taskCount--;
          if (taskCount==0)
            callback(code);
        }).fail(function() {
          Espruino.Core.Notifications.error("Error contacting server. Unable to compile code"+description+" right now.");
          taskCount--;
          if (taskCount==0) callback(code);
        });
      });

    } catch (err) {
      console.log(err);
      Espruino.Core.Notifications.error("Error parsing JavaScript"+description+", but uploading anyway.<br/>"+err.toString());
    }
    if (tasks==0)
      callback(code);
  }

  Espruino.Plugins.Compiler = {
    init : init,
  };
}());
