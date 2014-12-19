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
  
  function isFloat(n) {
    return n === +n && n !== (n|0);
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
        return x.call("jsvMathsOp", l, r, node.operator.charCodeAt(0)+"/* "+node.operator+" */");
      },
      "Literal" : function(x, node) {
        if (typeof node.value == "string")
          return x.call("jsvNewFromString", x.addBinaryData(node.value));
        else if (typeof node.value == "number") {
          if (isFloat(node.value)) 
            return x.call("jsvNewFromFloat", x.addBinaryData(node.value));
          else
            return x.call("jsvNewFromInteger", x.addBinaryData(node.value));
        } else console.warn("Unknown literal type "+typeof node.value);
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
        else if (typeof data == "number") {
          if (isFloat(data)) {
            var b = new ArrayBuffer(8);
            new Float64Array(b)[0] = data;
            data = String.fromCharCode.apply(null,new Uint8Array(b));
          } else {
            var b = new ArrayBuffer(4);
            new Int32Array(b)[0] = data;
            data = String.fromCharCode.apply(null,new Uint8Array(b));
          }
        } else console.warn("Unknown data type "+typeof node.value);
        
        // check for dups, work out offset
        for (var n in constData) {
          if (data == constData[n]) 
            return "const_"+n;
          // add to offset - all needs to be word aligned
        }
        // otherwise add to array
        return "const_"+(constData.push(data)-1);
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
    
    constData.forEach(function(c,n) {
      x.out("const_"+n+":");
      for (var i=0;i<c.length;i+=4) {
        var word = 
          (c.charCodeAt(i  )) |
          (c.charCodeAt(i+1) << 8) |
          (c.charCodeAt(i+2) << 16) |
          (c.charCodeAt(i+3) << 24);
        x.out("  .word 0x"+word.toString(16)+" ; "+JSON.stringify(c.substr(i,4)));                
      }
    });
    
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