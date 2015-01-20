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
  
  function stackValue(x, opts) {
    var stackDepth = x.getStackDepth();
    var s = { 
      type : "stackValue",
      get : function(x, register) { 
        var relativeDepth = x.getStackDepth()-stackDepth;
        x.out("  ldr "+register+", [sp, #"+(relativeDepth*4)+"]"); 
      }, 
      pop : function(x, register) { 
        x.out("  pop {"+register+"}"); 
      }, 
      free : function(x) { 
        // make sure we 
        x.addTrampoline("jsvUnLock");
        x.out("  pop {r0}"); 
        x.out("  bl jsvUnLock"); 
      },
    };
    if (opts)
      for (var o in opts)
        s[o] = opts[o];
    return s;
  }
  
  function isStackValue(x) {
    return (typeof x == "object") && ("type" in x) && (x.type=="stackValue");
  }

  function constValue(x, label, size) { // if size==0 its a pointer
    return { 
      type : "constValue",
      get : function(x, register) { 
        if (size==0) { // pointer
          if (x.getCodeSize()&2) x.out("  nop"); // need to align this for the ldr instruction
          x.out("  adr "+register+", "+label); 
        } else {
          for (var i=0;i<size;i++) {
            if (x.getCodeSize()&2) x.out("  nop"); // need to align this for the ldr instruction
            x.out("  ldr r"+(0|register.substr(1)+i)+", "+label+"+"+(i*4)); 
          }
        }
      }, 
      pop : function(x, register) { 
        this.get(x, register);
      }, 
      free : function(x) { },
    };
  }

  function isConstValue(x) {
    return (typeof x == "object") && ("type" in x) && (x.type=="constValue");
  }
  
  function setVariable(x,left,right) {    
    if (left.type=="Identifier" && x.getLocal(left.name)!==undefined) {
      var local = x.getLocal(left.name);
      // it's a local variable. We treat these differently as we write straight to the stack
      // get the RHS
      var r = x.handle(right);
      // Unlock the existing variable
      x.addTrampoline("jsvUnLock");
      x.out("  ldr r0, [r7, #"+(local.offset*4)+"]", "Get "+local.type+" "+local.name);      
      x.out("  bl jsvUnLock", "Unlock Existing "+local.name);
      // write RHS to LHS
      r.pop(x, "r0");
      x.out("  str r0, [r7, #"+(local.offset*4)+"]", "Save to variable "+local.name);
    } else {
      // otherwise we don't really know - just try ReplaceWith
      var l = x.handle(left);
      var r = x.handle(right);
      // TODO: we can probably skip the SkipName if we've had a jsvMathsOpSkipNames already
      var rs = x.call("jsvSkipName", r); // make sure we get rid of names (if there were any)
      x.call("jspReplaceWith", l, rs);
    }
  }

  var handlers = {
      "EmptyStatement" : function(x, node) {
      },
      "BlockStatement" : function(x, node) {
        node.body.forEach(function(s) {
          var v = x.handle(s);
          if (v) v.free(x);
        });
      },
      "IfStatement" : function(x, node) {
        var v = x.handle(node.test);
        var vbool = x.call("jsvGetBool", v);
        vbool.pop(x,"r4");  
        // DO NOT UNLOCK - it's a bool
        var lFalse = x.getNewLabel("_if_false");
        x.out("  cmp r4, #0");       
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
      "WhileStatement" : function(x, node) {
        var lTest = x.getNewLabel("_while_test");
        var lEnd =  x.getNewLabel("_while_end");
        var lBody =  x.getNewLabel("_while_body");
        x.out(lTest+":");
        var v = x.handle(node.test);
        var vbool = x.call("jsvGetBool", v);
        vbool.pop(x,"r4"); 
        // DO NOT UNLOCK - it's a bool
        x.out("  cmp r4, #0");          
        x.out("  bne "+lBody);
        x.out("  b "+lEnd, "Done in case jump is a large one"); 
        x.out(lBody+":");
        x.handle(node.body);        
        x.out("  b "+lTest);
        x.out(lEnd+":");  
      },
      "ReturnStatement" : function(x, node) {
        var v = x.handle(node.argument);
        if (v) v.pop(x,"r0");
        x.out("  b end_of_fn");
      },  
      "ExpressionStatement" : function(x, node) {
        return x.handle(node.expression);
      },
      "AssignmentExpression" : function(x, node) {
        if (node.operator != "=")
          console.warn("Unhandled AssignmentExpression '"+node.operator+"'");
        setVariable(x, node.left, node.right);
      },      
      "BinaryExpression" : function(x, node) {
        var l = x.handle(node.left);
        var r = x.handle(node.right);
        var v = x.call("jsvMathsOpSkipNames", l, r, node.operator.charCodeAt(0));
        return v;
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
        var local = x.getLocal(node.name);
        if (local !== undefined) {
          // then it's a local variable
          x.out("  ldr r0, [r7, #"+(local.offset*4)+"]", "Get "+local.type+" "+local.name);
          /* using LockAgain here isn't perfect, but it works. Ideally we'd know that 
           local variables don't need locking and unlocking, except when they are returned */
          x.addTrampoline("jsvLockAgainSafe");
          x.out("  bl jsvLockAgainSafe");
          x.out("  push {r0}");
          return stackValue(x, { valueType : local.type });
        } else { 
          // else search for the global variable
          var name = x.addBinaryData(node.name);
          return x.call("jspeiFindInScopes", name);
        }
      },
      "VariableDeclaration" : function (x, node) {
        node.declarations.forEach(function (node) {
          if (node.init) {
            setVariable(x, node.id, node.init);
          }
        });
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
      "getLocal" : function (name) { // get the local, or undefined
        if (name in locals) return locals[name];
        return undefined;
      },  
      "handle": function(node) {
        if (node.type in handlers)
          return handlers[node.type](x, node);
        console.warn("Unknown", node);
        throw new Error(node.type+" is not implemented yet");

        return undefined;
      },
      "getNewLabel" : function(helper) {
         return "label_"+labelCounter+helper;
      },
      // Store binary data and return a pointer
      "addBinaryData": function(data) {
        var size = 1;
        if (typeof data == "string") {
          data += "\0";
          size = 0; // pointer
        } else if (typeof data == "number" || typeof data == "boolean") {
          if (isFloat(data)) {
            var b = new ArrayBuffer(8);
            new Float64Array(b)[0] = data;
            data = String.fromCharCode.apply(null,new Uint8Array(b));
            size = 2; // floats are 64 bit
          } else {
            if (data>=0 && data<255) return data; // if it can be stored in a singl 'mov' instruction, just do that
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
            return constValue(x, "const_"+n, size);
          // add to offset - all needs to be word aligned
        }
        // otherwise add to array
        return constValue(x, "const_"+(constData.push(data)-1), size);
      },
      "addTrampoline" : function(name) {        
        if (trampolines.indexOf(name) < 0)
          trampolines.push(name);
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
      "getStackDepth": function() { // get the current size of the code
        var depth = 0;
        assembly.forEach(function(line) { 
          if (line.trim().substr(-1)!=":") { // ignore labels
            var op = line.trim().split(" ")[0];
            if (op=="push") depth++;
            if (op=="pop") depth--;
          }
        });
        return depth;
      },
      "call": function(name /*, ... args ... */) {
        var returnType = (name!="jspReplaceWith") ? "JsVar" : "void";
        var hasStackValues = false; 
        for (var i=arguments.length-2;i>=0;i--) {
          var arg = arguments[i+1];
          if (isStackValue(arg)) {
            hasStackValues = true;
            arg.get(x, "r"+i);
          } else if (isConstValue(arg)) {
            arg.get(x, "r"+i);
          } else if (typeof arg == "number") {
            x.out("  mov r"+i+", #"+arg);
          } else {
            throw new Error("Unknown arg type "+typeof arg);
          }
        }   
        if (exportNames.indexOf(name)>=0)
          x.addTrampoline(name);
        x.out("  bl "+name);

        var resultReg = "r0";

        // free any values that were on the stack
        if (hasStackValues) {
          if (returnType!="void") {
            x.out("  mov r4, r0"); // jsvUnLock will overwrite r0 - save as r4
            resultReg = "r4";
          }
          for (var i=arguments.length-2;i>=0;i--) {
            var arg = arguments[i+1];
            if (isStackValue(arg))
              arg.free(x);
          }
        }

        if (returnType != "void") { 
          x.out("  push {"+resultReg+"}", returnType);
          return stackValue(x); 
        } else
          return undefined;
      }
    };

    var localVariables = [];
    acorn.walk.simple(node, { 
      "Identifier" : function(n) {
        //console.log("Identifier "+n.name);
      },
      "VariableDeclaration" : function (n) {
        n.declarations.forEach(function (n) {
          //console.log(n);
          localVariables.push(n.id.name);
        });
    }});

    // r6 is for trampolining
    // r7 is a frame pointer
    x.out("  push {r6,r7,lr}", "Save registers that might get overwritten");
    
    // only first 4 are in registers, the rest are already on the stack
    var regsOnStack = (node.params.length>4) ? 4 : node.params.length;
    var stackItems = regsOnStack + localVariables.length;
    if (stackItems>0)
      x.out("  sub sp, #"+(stackItems*4), "add space for "+regsOnStack+" params and "+localVariables.length+" local vars on the stack"); 
    x.out("  add r7, sp, #0", "copy current stack pointer to r7"); 
    // Parse parameters and push onto stack    
    node.params.forEach(function( paramNode, idx) { 
      // FIXME: >4 arguments seems to shift them all by 1 somehow. Maybe the first one went on the stack and others in registers?
      locals[paramNode.name] = { type : "param", offset : (idx<4) ? idx : idx+3/*because we pushed 3 items above*/+localVariables.length, name : paramNode.name };
      if (idx<4) // only first 4 on stack
        x.out("  str r"+idx+", [r7, #"+(idx*4)+"]", "copy param "+paramNode.name+" onto stack");
      params.push("JsVar"); 
    }); 
    // add 'locals' for the local Variables that we found
    localVariables.forEach(function(name, idx) {
      var local = { type : "localVar", offset : idx + regsOnStack, name : name };
      locals[name] = local;      
      x.out("  mov r0, #0", "Load 0 = undefined");
      x.out("  str r0, [r7, #"+(local.offset*4)+"]", "Initialise "+local.name+" to undefined");
    });
    //console.log(locals);
    // Serialise all statements
    node.body.body.forEach(function(s, idx) {
      if (idx==0) return; // we know this is the 'compiled' string
      var v = x.handle(s);
      if (v) v.free(x);
    });  
    x.out("  mov r0, #0", "No explicit return = return undefined");  
    x.out("end_of_fn:");  
    // add 'locals' for the local Variables that we found
    x.out("  push {r0}", "save return value");
    for (var name in locals) {
      var local = locals[name];
      if (local.type == "localVar") {
        x.out("  ldr r0, [r7, #"+(local.offset*4)+"]", "Get "+local.type+" "+local.name);
        x.addTrampoline("jsvUnLock");
        x.out("  bl jsvUnLock", "Unlock Existing "+local.name);
      }
    }
    x.out("  pop {r0}", "restore return value");
    if (stackItems>0)
      x.out("  add sp, #"+(stackItems*4), "take local vars of the stack");
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
    try {
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
              console.warn(err.stack);
              Espruino.Core.Notifications.warning("<b>In 'compiled' function:</b><br/>"+err.toString());
            }
            if (asm) {
              asm = asm;
              //console.log(asm);
              //console.log(node);
              code = code.substr(0,node.start+offset) + asm + code.substr(node.end+offset);
              offset += asm.length - (node.end-node.start); // offset for future code snippets
            }
          }
        }
      });
    } catch (err) {
      console.log(err);
      console.warn("Acorn parse for plugins/compiler.js failed. Your code is probably broken.");
    }
    //console.log(code);
    callback(code);
  }
  
  Espruino.Plugins.Compiler = {
    init : init,
  };
}());
