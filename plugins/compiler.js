/**
 Copyright 2014 Gordon Williams (gw@pur3.co.uk)

 This Source Code is subject to the terms of the Mozilla Public
 License, v2.0. If a copy of the MPL was not distributed with this
 file, You can obtain one at http://mozilla.org/MPL/2.0/.
 
 ------------------------------------------------------------------
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
    // When code is sent to Espruino, search it for modules and add extra code required to load them 
    Espruino.addProcessor("transformForEspruino", function(code, callback) {
      compileCode(code, callback);
    });
  }
  
  function stackValue() {
    return "[stack]";
  }
  
  function isStackValue(x) {
    return x=="[stack]";
  }
  
  var handlers = {
      "BlockStatement" : function(x, node) {
        node.body.forEach(function(s) {
          var v = x.handle(s);
          if (v) x.call("jsvUnLock",v);
        });
      },
      "ReturnStatement" : function(x, node) {
        var v = x.handle(node.argument);
        if (v) x.out("POP {r0}");
        x.out("BX LR");
      },  
      "ExpressionStatement" : function(x, node) {
        return x.handle(node.expression);
      },
      "AssignmentExpression" : function(x, node) {
        if (node.operator != "=")
          console.warn("Unhandled AssignmentExpression '"+node.operator+"'");
        var l = x.handle(node.left);
        var r = x.handle(node.right);
        return x.call("jspReplaceWith", l, r);
      },      
      "BinaryExpression" : function(x, node) {
        var l = x.handle(node.left);
        var r = x.handle(node.right);
        return x.call("jsvMathsOp", l, r, node.operator);
      },
      "Literal" : function(x, node) {
        return x.call("jsvNewFromString", x.addBinaryData(node.value));
      },        
      "Identifier" : function(x, node) {
        var name = x.addBinaryData(node.name);
        return x.call("jspeiFindInScopes", name);
      }
  };
  
  function compileFunction(node) {
    var constData = [];
    var x = {      
      "handle": function(node) {
        if (node.type in handlers)
          return handlers[node.type](x, node);
        console.warn("No handler for "+node.type);
        console.warn(node);
        return undefined;
      },
      // Store binary data and return a pointer
      "addBinaryData": function(data) {
        // strings need zero terminating
        if (typeof data == "string") data+="\0";
        // check for dups, work out offset
        var offs = 0;
        for (var i in constData) {
          if (data == constData[i]) 
            return "consts + "+offs+"";
          offs += constData.length;
        }        
        constData.push(data);        
        return "consts + "+offs+"";
      },
      "out": function(data) {
        console.log("] "+data);
      },
      "call": function(name /*, ... args ... */) {
        for (var i=0;i<arguments.length-1;i++) {
          var arg = arguments[i+1];
          if (isStackValue(arg))
            x.out("POP {r"+i+"}");
          else
            x.out("MOVL r"+i+", "+arg);
        }
        x.out("BL "+name);
        if (name!="jsvUnLock") {
          x.out("PUSH {r0}");
          return stackValue();
        } else
          return undefined;
      }
    };
    
    node.body.body.forEach(function(s, idx) {
      if (idx==0) return; // we know this is the 'compiled' string
      var v = x.handle(s);
      if (v) x.call("jsvUnLock",v);
    });    
    console.log("] consts: ");
    console.log("] "+JSON.stringify(constData.join("")));
  }

  function compileCode(code, callback) {
    var ast = acorn.parse(code, { ecmaVersion : 6 });
    ast.body.forEach(function(node) {
      if (node.type=="FunctionDeclaration") {
        if (node.body.type=="BlockStatement" &&
            node.body.body.length>0 &&
            node.body.body[0].type=="ExpressionStatement" &&
            node.body.body[0].expression.type=="Literal" && 
            node.body.body[0].expression.value=="compiled") {
          compileFunction(node);
        }
      }
    });
    callback(code);
  }
  
  Espruino.Plugins.ExamplePlugin = {
    init : init,
  };
}());