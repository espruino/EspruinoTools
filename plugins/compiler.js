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
      "IfStatement" : function(x, node) {
        var v = x.handle(node.test);
        var vbool = x.call("jsvGetBool", v);
        x.out("  pop {r0}");
        x.out("  cmp r0, #0");
        var lFalse = x.getNewLabel("_if_false");
        x.out("  bne "+lFalse);
        x.handle(node.consequent);        
        if (node.alternate) {
          var lEnd =  x.getNewLabel("_if_end");
          x.out("  b "+lEnd);
          x.out(lFalse+":");
          x.handle(node.alternale);
          x.out(lEnd+":");
        } else {
          x.out(lFalse+":");
        }        
      },
      "ReturnStatement" : function(x, node) {
        var v = x.handle(node.argument);
        if (v) x.out("  pop {r0}");
        x.out("  b end_of_fn");
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
        return x.call("jsvMathsOpSkipNames", l, r, node.operator.charCodeAt(0));
      },
      "Literal" : function(x, node) {
        if (typeof node.value == "string")
          return x.call("jsvNewFromString", x.addBinaryData(node.value));
        else if (typeof node.value == "boolean")
          return x.call("jsvNewFromBool", x.addBinaryData(node.value)); // TODO: store number inline
        else if (typeof node.value == "number") {
          if (isFloat(node.value)) 
            return x.call("jsvNewFromFloat", x.addBinaryData(node.value)); // TODO: store number inline
          else 
            return x.call("jsvNewFromInteger", x.addBinaryData(node.value)); // TODO: store number inline
        } else throw new Error("Unknown literal type "+typeof node.value);
      },        
      "Identifier" : function(x, node) {
        var localOffset = x.getLocalOffset(node.name);
        if (localOffset !== undefined) {
          x.out("  ldr r0, [r7, #"+(localOffset*4)+"]", "Get argument "+node.name);
          x.out("  push {r0}");
          return stackValue();
        } else { 
          // else search for the global variable
          var name = x.addBinaryData(node.name);
          return x.call("jspeiFindInScopes", name);
        }
      }
  };
  
  function compileFunction(node) {
    var board = Espruino.Core.Env.getBoardData();
    if (typeof board.EXPORT != "object") {
      console.warn("Compiler not active as no process.env.EXPORT available");
      return undefined;
    }
    var exportPtr = board.EXPORT[1];
    var exportNames = board.EXPORT[0].split(",");

    var locals = {}; // dictionary of local variables
    var params = []; // simple list of the type of each parameter
    var constData = []; // constants that get shoved at the end of the code
    var trampolines = []; // which trampoline functions we need to make
    var assembly = []; // assembly that is output
    var labelCounter = 0;
    var x = {    
      "getLocalOffset" : function (name) { // get the offset of the local, or undefined
        if (name in locals) return locals[name].offset;
        return undefined;
      },  
      "handle": function(node) {
        if (node.type in handlers)
          return handlers[node.type](x, node);
        console.warn("Unknown", node);
        throw new Error("No handler for "+node.type);

        return undefined;
      },
      "getNewLabel" : function(helper) {
         return "label_"+labelCounter+helper;
      },
      // Store binary data and return a pointer
      "addBinaryData": function(data) {
        // TODO: what if this could have been stored directly in a thumb operation
        // strings need zero terminating
        var prefix = "";
        if (typeof data == "string") {
          data += "\0";
          prefix = "*"; // it's a pointer
        } else if (typeof data == "number" || typeof data == "boolean") {
          if (isFloat(data)) {
            var b = new ArrayBuffer(8);
            new Float64Array(b)[0] = data;
            data = String.fromCharCode.apply(null,new Uint8Array(b));
          } else {
            var b = new ArrayBuffer(4);
            new Int32Array(b)[0] = data;
            data = String.fromCharCode.apply(null,new Uint8Array(b));
          }
        } else {
          throw new Error("Unknown data type "+typeof data );
        }
        
        // check for dups, work out offset
        for (var n in constData) {
          if (data == constData[n]) 
            return prefix+"const_"+n;
          // add to offset - all needs to be word aligned
        }
        // otherwise add to array
        return prefix+"const_"+(constData.push(data)-1);
      },
      "out": function(data, comment) {
        console.log("] "+data + (comment?("\t\t; "+comment):""));
        assembly.push(data);
      },
      "getCodeSize": function() { // get the current size of the code
        var s = 0;
        assembly.forEach(function(line) { 
          if (line.trim().substr(-1)!=":") { // ignore labels
            var bigOnes = ["bl","movw",".word"]; // 4 byte instructuons
            s += (bigOnes.indexOf(line.trim().split(" ")[0])>=0) ? 4 : 2; 
          }
        });
        return s;
      },
      "call": function(name /*, ... args ... */) {
        for (var i=arguments.length-2;i>=0;i--) {
          var arg = arguments[i+1];
          if (isStackValue(arg))
            x.out("  pop {r"+i+"}");
          else if (typeof arg == "number")
            x.out("  movs r"+i+", #"+arg);
          else {
            if (x.getCodeSize()&2) x.out("  nop"); // need to align this for the ldr instruction
            if (arg[0]=="*")
              x.out("  adr r"+i+", "+arg.substr(1)); // return pointer
            else
              x.out("  ldr r"+i+", "+arg);
          }
        }   
        var exportIdx = exportNames.indexOf(name);
        if (exportIdx>=0) {
          // Just make sure we create a trampoline for this
          if (trampolines.indexOf(name) < 0)
            trampolines.push(name);
        }
        x.out("  bl "+name);
        
        if (name!="jsvUnLock") {
          x.out("  push {r0}");
          return stackValue();
        } else
          return undefined;
      }
    };
    // r6 is for trampolining
    // r7 is a frame pointer
    x.out("  push {r6,r7,lr}", "Save registers that might get overwritten");  
    var stackItems = node.params.length;
    if (stackItems>4) stackItems = 4; // only first 4 are in registers
    x.out("  sub sp, #"+(stackItems*4), "add space for local vars of the stack"); 
    x.out("  add r7, sp, #0", "copy current stack pointer to r7"); 
    // Parse parameters and push onto stack    
    node.params.forEach(function( paramNode, idx) { 
      // FIXME: >4 arguments seems to shift them all by 1 somehow. Maybe the first one went on the stack and others in registers?
      locals[paramNode.name] = { type : "param", offset : (idx<4) ? idx : idx+3/*because we pushed 3 items above*/ };
      if (idx<4) // only first 4 on stack
        x.out("  str r"+idx+", [r7, #"+(idx*4)+"]", "copy params onto stack");
      params.push("JsVar"); 
    }); 
    // Serialise all statements
    node.body.body.forEach(function(s, idx) {
      if (idx==0) return; // we know this is the 'compiled' string
      var v = x.handle(s);
      if (v) x.call("jsvUnLock",v);
    });  
    x.out("end_of_fn:");  
    x.out("  add sp, #"+(stackItems*4), "take loal vars of the stack"); 
    x.out("  pop {r6,r7,lr}", "Restore registers that might get overwritten");
    x.out("  bx lr"); 
    // add trampoline functions
    trampolines.forEach(function(tramp) {
      if (x.getCodeSize()&2) x.out("  nop"); // need to align this for the ldr instruction
      x.out(tramp+":");
      x.out("  ldr    r6, exports");
      x.out("  ldr    r6, [r6, #"+(exportNames.indexOf(tramp)*4)+"]", "Get fn address");
      x.out("  bx r6");
    });
    // work out length and align to a word boundary
    if (x.getCodeSize()&2) x.out("  nop");
    // add exports - TODO: maybe we should just try and find out the actual function pointers? it'd be a bunch easier
     x.out("exports:");
    x.out("  .word "+exportPtr, "Function table pointer");
    // Write out any of the constants
    constData.forEach(function(c,n) {
      x.out("const_"+n+":");
      for (var i=0;i<c.length;i+=4) {
        var word = 
          (c.charCodeAt(i  )) |
          (c.charCodeAt(i+1) << 8) |
          (c.charCodeAt(i+2) << 16) |
          (c.charCodeAt(i+3) << 24);
        x.out("  .word 0x"+word.toString(16),  /*comment*/JSON.stringify(c.substr(i,4)));                
      }
    });
    // now try and assemble it
    //console.log(Espruino.Plugins.Assembler.asm(assembly));
    
    var paramSpec = "JsVar ("+params.join(",")+")";
    // wrap this up into an actual 'E.asm' statement:
    return "var "+node.id.name+" = "+"E.asm(\""+paramSpec+"\",\n  "+assembly.map(JSON.stringify).join(",\n  ")+");";
  }

  function compileCode(code, callback) {
    var offset = 0;
    var ast = acorn.parse(code, { ecmaVersion : 6 });
    ast.body.forEach(function(node) {
      if (node.type=="FunctionDeclaration") {
        if (node.body.type=="BlockStatement" &&
            node.body.body.length>0 &&
            node.body.body[0].type=="ExpressionStatement" &&
            node.body.body[0].expression.type=="Literal" && 
            node.body.body[0].expression.value=="compiled") {
          try {
            var asm = compileFunction(node);
          } catch (err) {
            console.warn(err.toString());
          }
          if (asm) {
            asm = asm;
            //console.log(asm);
            //console.log(node);
            code = code.substr(0,node.start+offset) + asm + code.substr(node.end+offset);
            offset += (node.end-node.start) + asm.length; // offset for future code snippets
          }
        }
      }
    });
    //console.log(code);
    callback(code);
  }
  
  Espruino.Plugins.Compiler = {
    init : init,
  };
}());
