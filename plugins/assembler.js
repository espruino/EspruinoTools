/**
 Copyright 2014 Gordon Williams (gw@pur3.co.uk)

 This Source Code is subject to the terms of the Mozilla Public
 License, v2.0. If a copy of the MPL was not distributed with this
 file, You can obtain one at http://mozilla.org/MPL/2.0/.

 ------------------------------------------------------------------
  Automatically run an assembler on inline assembler statements
 ------------------------------------------------------------------
**/
"use strict";
(function(){

  var base64_encode;
  if (typeof btoa == "undefined")
    base64_encode = function(s) { return Buffer.from(s).toString('base64'); };
  else
    base64_encode = btoa;

/*  Thumb reference :
    http://ece.uwaterloo.ca/~ece222/ARM/ARM7-TDMI-manual-pt3.pdf

    ARM reference
    https://web.eecs.umich.edu/~prabal/teaching/eecs373-f11/readings/ARMv7-M_ARM.pdf
*/

  // list of registers (for push/pop type commands)
  function rlist_lr(value) {
   var regs = value.split(",");
   var vals = { r0:1,r1:2,r2:4,r3:8,r4:16,r5:32,r6:64,r7:128,lr:256 };
   var bits = 0;
   for (var i in regs) {
     var reg = regs[i].trim();
     if (!(reg in vals))  throw "Unknown register name "+reg;
     bits |= vals[reg];
   }
   return bits;
  }

  function reg(reg_offset) {
    return function(reg) {
      var vals = { r0:0,r1:1,r2:2,r3:3,r4:4,r5:5,r6:6,r7:7 };
      if (!(reg in vals)) throw "Unknown register name "+reg;
      return vals[reg]<<reg_offset;
    };
  }
  function reg4(reg_offset) { // 4 bit register
    return function(reg) {
      var vals = { r0:0,r1:1,r2:2,r3:3,r4:4,r5:5,r6:6,r7:7,
                   r8:8,r9:9,r10:10,r11:11,r12:12,r13:13,r14:14,r15:15,
                   lr:14, pc:15 };
      if (!(reg in vals)) throw "Unknown register name "+reg;
      return vals[reg]<<reg_offset;
    };
  }


  function reg_or_immediate(reg_offset, immediate_bit) {
    return function(reg) {
      var regVal = parseInt(reg);
      if (regVal>=0 && regVal<8)
        return ((regVal&7)<<reg_offset) | (1<<immediate_bit);
      var vals = { r0:0,r1:1,r2:2,r3:3,r4:4,r5:5,r6:6,r7:7 };
      if (!(reg in vals)) throw "Unknown register name, or immediate out of range 0..7 "+reg;
      return vals[reg]<<reg_offset;
    };
  }

  function reg_base_offset(base_offset, offset_offset) {
   return function(value) {
     var parms = value.split(",");
     return reg(base_offset)(parms[0]) | reg(offset_offset)(parms[0]);
   };
  }

  function thumb2_immediate_t3(value) {
    if (value[0]!="#")
      throw new "Expecting '#' before number";
    var v = parseInt(value.substr(1));
    if (v>=0 && v<65536) {
      // https://web.eecs.umich.edu/~prabal/teaching/eecs373-f11/readings/ARMv7-M_ARM.pdf page 347
      var imm4,i,imm3,imm8; // what the...?
      imm4 = (v>>12)&15;
      i = (v>>11)&1;
      imm3 = (v>>8)&7;
      imm8 = v&255;
      return (i<<26) | (imm4<<16) | (imm3<<12) | imm8;
    }
    throw "Invalid number '"+value+"' - must be between 0 and 65535";
  }

  function _int(offset, bits, shift, signed) {
    return function(value, labels) {
      var maxValue = ((1<<bits)-1) << shift;
      var minValue = 0;
      if (signed) {
        minValue = -(1<<(bits-1));
        maxValue += minValue;
      }

      var binValue = undefined;
      if (value[0]=="#") {
        binValue = parseInt(value.substr(1));
      } else {
        var addValue = 0;
        var maths = value.indexOf("+");
        if (maths >= 0) {
          addValue = parseInt(value.substr(maths));
          value = value.substr(0,maths);
        }
        if (value in labels)
          binValue = labels[value] + addValue - labels["PC"];
        else
          throw "Unknown label '"+value+"'";
      }


      //console.log("VALUE----------- "+binValue+" PC "+labels["PC"]+" L "+labels[value]);

      if (binValue>=minValue && binValue<=maxValue && (binValue&((1<<shift)-1))==0)
        return ((binValue >> shift) & ((1<<bits)-1)) << offset;

      var msg = "Invalid number '"+value+"' ("+binValue+") - must be between 0 and "+maxValue;
      if (shift!=0) msg += " and a multiple of "+(1<<shift);
      throw msg;
    };
  }

  function uint(offset, bits, shift) {
    return _int(offset, bits, shift, false);
  }

  function sint(offset, bits, shift) {
    return _int(offset, bits, shift, true);
  }

  // special 23-bit address (bottom bit ignored) split into two halves
  function bl_addr() {
    var normal = sint(0, 22, 1); // un-split address
    return function(value, labels) {
      var v = normal(value, labels);
      return ((v>>11)&0x7FF)<<16 | (v&0x7FF);
    };
  }

  var ops = {
    // Format 1: move shifted register
    "lsl"  :[{ base:"00000-----___---", regex : /(r[0-7]),(r[0-7]),(#[0-9]+)$/, args:[reg(0),reg(3),uint(6,5,0)] },
             { base:"0100000010___---", regex : /(r[0-7]),(r[0-7])$/, args:[reg(0),reg(3)] }], // 5.4 d = d << s
    "lsr"  :[{ base:"00001-----___---", regex : /(r[0-7]),(r[0-7]),(#[0-9]+)$/, args:[reg(0),reg(3),uint(6,5,0)] },
             { base:"0100000011___---", regex : /(r[0-7]),(r[0-7])$/, args:[reg(0),reg(3)] }], // 5.4 d = d >> s
    "asr"  :[{ base:"00010-----___---", regex : /(r[0-7]),(r[0-7]),(#[0-9]+)$/, args:[reg(0),reg(3),uint(6,5,0)] },
             { base:"0100000100___---", regex : /(r[0-7]),(r[0-7])$/, args:[reg(0),reg(3)] }], // 5.4 d = d >>> s
    // 5.2 Format 2: add/subtract
    // 00011
    // 5.3 Format 3: move/compare/add/subtract immediate
    "cmp"  :[{ base:"00101---________", regex : /(r[0-7]),(#[0-9]+)$/, args:[reg(8),uint(0,8,0)] }, // move/compare/subtract immediate
             { base:"0100001010___---", regex : /(r[0-7]),(r[0-7])$/, args:[reg(0),reg(3)] }], // 5.4 test d-s
    // 5.4 Format 4: ALU operations
    "and"  :[{ base:"0100000000___---", regex : /(r[0-7]),(r[0-7])$/, args:[reg(0),reg(3)] }],
    "eor"  :[{ base:"0100000001___---", regex : /(r[0-7]),(r[0-7])$/, args:[reg(0),reg(3)] }],
    // lsl is above
    // lsr is above
    // asr is above
    "adc"  :[{ base:"0100000101___---", regex : /(r[0-7]),(r[0-7])$/, args:[reg(0),reg(3)] }], // d + s + carry
    "sbc"  :[{ base:"0100000110___---", regex : /(r[0-7]),(r[0-7])$/, args:[reg(0),reg(3)] }], // d - s - !carry
    "ror"  :[{ base:"0100000111___---", regex : /(r[0-7]),(r[0-7])$/, args:[reg(0),reg(3)] }], // rotate right
    "tst"  :[{ base:"0100001000___---", regex : /(r[0-7]),(r[0-7])$/, args:[reg(0),reg(3)] }], // test
    "neg"  :[{ base:"0100001001___---", regex : /(r[0-7]),(r[0-7])$/, args:[reg(0),reg(3)] }], // - s
    // cmp is above
    "cmn"  :[{ base:"0100001011___---", regex : /(r[0-7]),(r[0-7])$/, args:[reg(0),reg(3)] }], // test d+s
    "orr"  :[{ base:"0100001100___---", regex : /(r[0-7]),(r[0-7])$/, args:[reg(0),reg(3)] }], // |
    "mul"  :[{ base:"0100001101___---", regex : /(r[0-7]),(r[0-7])$/, args:[reg(0),reg(3)] }], // s*d
    "bic"  :[{ base:"0100001110___---", regex : /(r[0-7]),(r[0-7])$/, args:[reg(0),reg(3)] }], // d & ~s
    "mvn"  :[{ base:"0100001111___---", regex : /(r[0-7]),(r[0-7])$/, args:[reg(0),reg(3)] }], // ~s
    // 5.5 Format 5: Hi register operations/branch exchange
    // 5.6 Format 6: PC-relative load
    //  done (below)
    // 5.7 Format 7: load/store with register offset
    //  done (below)
    // 5.8 Format 8: load/store sign-extended byte/halfword
    // 5.9 Format 9: load/store with immediate offset
    //  done (below)
    // 5.10 Format 10: load/store halfword
    // 5.11 Format 11: SP-relative load/store
    // 5.12 Format 12: load address
    // done (below)
    // 5.13 Format 13: add offset to Stack Pointer
    // 5.14 Format 14: push/pop registers
    //  done (below)
    // 5.16 Format 16: conditional branch
    "beq" :[{ base:"11010000________", regex : /^(.*)$/, args:[sint(0,8,1)] }], // 5.16 Format 16: conditional branch
    "bne" :[{ base:"11010001________", regex : /^(.*)$/, args:[sint(0,8,1)] }], // 5.16 Format 16: conditional branch
    "bcs" :[{ base:"11010010________", regex : /^(.*)$/, args:[sint(0,8,1)] }], // 5.16 Format 16: conditional branch
    "bcc" :[{ base:"11010011________", regex : /^(.*)$/, args:[sint(0,8,1)] }], // 5.16 Format 16: conditional branch
    "bmi" :[{ base:"11010100________", regex : /^(.*)$/, args:[sint(0,8,1)] }], // 5.16 Format 16: conditional branch
    "bpl" :[{ base:"11010101________", regex : /^(.*)$/, args:[sint(0,8,1)] }], // 5.16 Format 16: conditional branch
    "bvs" :[{ base:"11010110________", regex : /^(.*)$/, args:[sint(0,8,1)] }], // 5.16 Format 16: conditional branch
    "bvc" :[{ base:"11010111________", regex : /^(.*)$/, args:[sint(0,8,1)] }], // 5.16 Format 16: conditional branch
    "bhi" :[{ base:"11011000________", regex : /^(.*)$/, args:[sint(0,8,1)] }], // 5.16 Format 16: conditional branch
    "bls" :[{ base:"11011001________", regex : /^(.*)$/, args:[sint(0,8,1)] }], // 5.16 Format 16: conditional branch
    "bge" :[{ base:"11011010________", regex : /^(.*)$/, args:[sint(0,8,1)] }], // 5.16 Format 16: conditional branch
    "blt" :[{ base:"11011011________", regex : /^(.*)$/, args:[sint(0,8,1)] }], // 5.16 Format 16: conditional branch
    "bgt" :[{ base:"11011100________", regex : /^(.*)$/, args:[sint(0,8,1)] }], // 5.16 Format 16: conditional branch
    "ble" :[{ base:"11011101________", regex : /^(.*)$/, args:[sint(0,8,1)] }], // 5.16 Format 16: conditional branch
    // 5.17 Format 17: software interrupt
    // 5.18 Format 18: unconditional branch
    "b"   :[{ base:"11100___________", regex : /^(.*)$/, args:[sint(0,11,1)] }],
    // 5.19 Format 19: long branch with link
    "bl"  :[{ base:"11110___________11111___________", regex : /^(.*)$/, args:[bl_addr()] }],
    "bx"   :[{ base:"010001110----000", regex : /(lr|r[0-9]+)$/, args:[reg4(3)] }],
    // ....


    "adr"  :[{ base:"10100---________", regex : /^(r[0-7]),([a-zA-Z_][0-9a-zA-Z_]*)$/,args:[reg(8),uint(0,8,2)] },  // ADR pseudo-instruction to save address (actually ADD PC)
             { base:"10100---________", regex : /^(r[0-7]),([a-zA-Z_][0-9a-zA-Z_]*\+[0-9]+)$/,args:[reg(8),uint(0,8,2)] }],
    "push" :[{ base:"1011010-________", regex : /^{(.*)}$/, args:[rlist_lr] }], // 5.14 Format 14: push/pop registers
    "pop"  :[{ base:"1011110-________", regex : /^{(.*)}$/, args:[rlist_lr] }], // 5.14 Format 14: push/pop registers
    "add"  :[{ base:"00110---________", regex : /(r[0-7]),(#[0-9]+)$/, args:[reg(8),uint(0,8,0)] }, // move/compare/subtract immediate
             { base:"10100---________", regex : /^(r[0-7]),pc,(#[0-9]+)$/,args:[reg(8),uint(0,8,2)] },
             { base:"10101---________", regex : /^(r[0-7]),sp,(#[0-9]+)$/, args:[reg(8),uint(0,8,2)] },
             { base:"101100000_______", regex : /^sp,(#[0-9]+)$/, args:[uint(0,7,2)] },
             { base:"00011-0___---___", regex : /^(r[0-7]),(r[0-7]),([^,]+)$/, args:[reg(0),reg(3),reg_or_immediate(6,10)] } ], // Format 2: add/subtract
    "adds" :[{ base:"00011-0___---___", regex : /^(r[0-7]),(r[0-7]),([^,]+)$/, args:[reg(0),reg(3),reg_or_immediate(6,10)] } ], //?
    "adc.w":[{ base:"111010110100----________--------", regex : /^(r[0-7]),(r[0-7]),(r[0-7])$/,args:[reg(16),reg(8),reg(0)] }], // made this up. probably wrong
    "add.w":[{ base:"11110001--------________--------", regex : /^(r[0-7]),(r[0-7]),(#[0-9]+)$/,args:[reg(16),reg(8),uint(0,8,0)] }], // made this up. probably wrong
    "sub"  :[{ base:"00111---________", regex : /(r[0-7]),(#[0-9]+)$/, args:[reg(8),uint(0,8,0)] }, // move/compare/subtract immediate
              /*{ base:"10100---________", regex : /^([^,]+),pc,(#[0-9]+)$/,args:[reg(8),uint(0,8,2)] },*/
             { base:"101100001_______", regex : /^sp,(#[0-9]+)$/, args:[uint(0,7,2)] },
             { base:"00011-1___---___", regex : /^([^,]+),([^,]+),([^,]+)$/, args:[reg(0),reg(3),reg_or_immediate(6,10)] } ],

    "str"  :[{ base:"0101000---___---", regex : /(r[0-7]),\[(r[0-7]),(r[0-7])\]$/, args:[reg(0),reg(3),reg(6)] }, // 5.7 Format 7: load/store with register offset
             { base:"10010---________", regex : /(r[0-7]),\[sp,(#[0-9]+)\]$/, args:[reg(8),uint(0,8,2)] }, // 5.11 SP-relative store
             { base:"0110000000___---", regex : /(r[0-7]),\[(r[0-7])\]$/, args:[reg(0),reg(3)] }, // 5.9 Format 9: load/store with no offset
             { base:"0110000---___---", regex : /(r[0-7]),\[(r[0-7]),(#[0-9]+)\]$/, args:[reg(0),reg(3), uint(6,5,2)] }], // 5.9 Format 9: load/store with immediate offset
    "strb" :[{ base:"0101010---___---", regex : /(r[0-7]),\[(r[0-7]),(r[0-7])\]$/, args:[reg(0),reg(3),reg(6)] }, // 5.7 Format 7: load/store with register offset
             { base:"01110-----___---", regex : /(r[0-7]),\[(r[0-7]),(#[0-9]+)\]$/, args:[reg(0),reg(3), uint(6,5,0)] }], // 5.9 Format 9: load/store with immediate offset
    "strh" :[{ base:"0101001---___---", regex : /(r[0-7]),\[(r[0-7]),(r[0-7])\]$/, args:[reg(0),reg(3),reg(6)] }, // 5.7 Format 7: load/store with register offset
             { base:"10000-----___---", regex : /(r[0-7]),\[(r[0-7]),(#[0-9]+)\]$/, args:[reg(0),reg(3), uint(6,5,1)] }], // 5.9 Format 9: load/store with immediate offset
    "ldr"  :[{ base:"01001---________", regex : /(r[0-7]),\[pc,(#[0-9]+)\]$/, args:[reg(8),uint(0,8,2)] }, // 5.6 Format 6: PC-relative load
             { base:"10011---________", regex : /(r[0-7]),\[sp,(#[0-9]+)\]$/, args:[reg(8),uint(0,8,2)] }, // 5.11 SP-relative load
             { base:"01001---________", regex : /(r[0-7]),([a-zA-Z_][0-9a-zA-Z_]*)$/, args:[reg(8),uint(0,8,2)] }, // 5.6 Format 6: PC-relative load (using label)
             { base:"01001---________", regex : /(r[0-7]),([a-zA-Z_][0-9a-zA-Z_]*\+[0-9]+)$/, args:[reg(8),uint(0,8,2)] }, // 5.6 Format 6: PC-relative load (using label and maths - huge hack)
             { base:"0101100---___---", regex : /(r[0-7]),\[(r[0-7]),(r[0-7])\]$/, args:[reg(0),reg(3),reg(6)] }, // 5.7 Format 7: load/store with register offset
             { base:"0110100000___---", regex : /(r[0-7]),\[(r[0-7])\]$/, args:[reg(0),reg(3)] }, // 5.9 Format 9: load/store with no offset
             { base:"0110100---___---", regex : /(r[0-7]),\[(r[0-7]),(#[0-9]+)\]$/, args:[reg(0),reg(3), uint(6,5,2)] }], // 5.9 Format 9: load/store with immediate offset

    "ldrb" :[{ base:"0101110---___---", regex : /(r[0-7]),\[(r[0-7]),(r[0-7])\]$/, args:[reg(0),reg(3),reg(6)] }, // 5.7 Format 7: load/store with register offset
             { base:"01111-----___---", regex : /(r[0-7]),\[(r[0-7]),(#[0-9]+)\]$/, args:[reg(0),reg(3), uint(6,5,0)] }], // 5.9 Format 9: load/store with immediate offset
    "ldrsb":[{ base:"0101011---___---", regex : /(r[0-7]),\[(r[0-7]),(r[0-7])\]$/, args:[reg(0),reg(3),reg(6)] }], // 5.7 Format 7: load/store with register offset
    "ldrh" :[{ base:"0101101---___---", regex : /(r[0-7]),\[(r[0-7]),(r[0-7])\]$/, args:[reg(0),reg(3),reg(6)] }, // 5.7 Format 7: load/store with register offset
             { base:"10001-----___---", regex : /(r[0-7]),\[(r[0-7]),(#[0-9]+)\]$/, args:[reg(0),reg(3), uint(6,5,1)] }], // 5.9 Format 9: load/store with immediate offset
    "ldrsh":[{ base:"0101111---___---", regex : /(r[0-7]),\[(r[0-7]),(r[0-7])\]$/, args:[reg(0),reg(3),reg(6)] }], // 5.7 Format 7: load/store with register offset
    "mov"  :[{ base:"00100---________", regex : /(r[0-7]),(#[0-9]+)$/, args:[reg(8),uint(0,8,0)] }, // move/compare/subtract immediate
             { base:"0001110000---___", regex : /(r[0-7]),(r[0-7])$/, args:[reg(0),reg(3)] }, // actually 'add Rd,Rs,#0'
             { base:"0100011010---101", regex : /sp,(r[0-7])$/, args:[reg(3)] }], // made up again
    "movs" :[{ base:"00100---________", regex : /(r[0-7]),(#[0-9]+)$/, args:[reg(8),uint(0,8,0)] }], // is this even in thumb?
    "movw" :[{ base:"11110-100100----0___----________", regex : /(r[0-7]),(#[0-9]+)$/, args:[reg4(8),thumb2_immediate_t3] }],

    ".word":[{ base:"--------------------------------", regex : /0x([0-9A-Fa-f]+)$/, args:[function(v){v=parseInt(v,16);return (v>>16)|(v<<16);}] },
             { base:"--------------------------------", regex : /([0-9]+)$/, args:[function(v){v=parseInt(v);return (v>>16)|(v<<16);}] }],
    "nop"  :[{ base:"0100011011000000", regex : "", args:[] }], // MOV R8,R8 (Format 5)
    "cpsie"  :[{ base:"1011011001100010", regex : /i/, args:[] }], // made up again
    "cpsid"  :[{ base:"1011011001110010", regex : /i/, args:[] }], // made up again
    "wfe"    :[{ base:"1011111100100000", regex : /i/, args:[] }],
    "wfi"    :[{ base:"1011111100110000", regex : /i/, args:[] }],

   // for this, uint needs to work without a hash
//    "swi"    :[{ base:"11011111--------", regex : /([0-9]+)$/, args:[uint(0,8,0)] }], // Format 17: software interrupt
  };


  function getOpCode(binary) {
   var base = "";
   for (var b in binary)
     if ("-_".indexOf(binary[b])>=0)
       base += "0";
     else
       base += binary[b];
   var opCode = parseInt(base,2);
   if (opCode<0) opCode = opCode + 2147483648.0;
   return opCode;
  }

  function assemble_internal(asmLines, wordCallback, labels) {
    var addr = 0;
    var newLabels = {};
    asmLines.forEach(function (line) {
      // setup labels
      if (labels!==undefined)
        labels["PC"] = addr+4;
      // handle line
      line = line.trim();
      if (line=="") return;
      if (line.substr(-1)==":") {
        // it's a label
        var labelName = line.substr(0,line.length-1);
        if (newLabels[labelName] !== undefined)
          throw "Label '"+labelName+"' was already defined";
        newLabels[labelName] = addr;
        return;
      }

      // parse instruction
      var firstArgEnd = line.indexOf("\t");
      if (firstArgEnd<0) firstArgEnd = line.indexOf(" ");
      if (firstArgEnd<0) firstArgEnd=line.length;
      var opName = line.substr(0,firstArgEnd);
      var args = line.substr(firstArgEnd).replace(/[ \t]/g,"").trim();
      if (!(opName in ops)) throw "Unknown Op '"+opName+"' in '"+line+"'";
      // search ops
      var found = false;
      for (var n in ops[opName]) {
        var op = ops[opName][n];
        var m;
        if (m=args.match(op.regex)) {
          found = true;
          // work out the base opcode
          var opCode = getOpCode(op.base);

          if (labels!==undefined) {
            /* If we're properly generating code, parse each argument.
             Otherwise we're just working out the size in bytes of each line
             and we can skip this */
            for (var i in op.args) {
              //console.log(i,m[(i|0)+1]);
              var argFunction = op.args[i];
              var bits = argFunction(m[(i|0)+1], labels);
              //console.log("  ",bits)
              opCode |= bits;
            }
          }

          if (op.base.length > 16) {
            wordCallback((opCode>>>16));
            wordCallback(opCode&0xFFFF);
            addr += 4;
          } else {
            wordCallback(opCode);
            addr += 2;
          }
          break;
        }
      }
      // now parse args
      if (!found)
        throw "Unknown arg style '"+args+"' in '"+line+"'";
    });
    return newLabels;
  }

  function assemble(asmLines, wordCallback) {
    // remove line comments
    asmLines = asmLines.map(function(l) {
      var i;
      i = l.indexOf(";");
      if (i>=0) l = l.substr(0,i);
      i = l.indexOf("//");
      if (i>=0) l = l.substr(0,i);
      return l;
    });
    // process assembly to grab labels
    var labels = assemble_internal(asmLines, function() {}, undefined);
    logger.debug("Assembler Labels:",labels);
    // process again to actually get an output
    assemble_internal(asmLines, wordCallback, labels);
  }

//---------------------------------------------------------------------------
//---------------------------------------------------------------------------
//---------------------------------------------------------------------------

  function init() {
    // When code is sent to Espruino, search it for bits of assembler and then assemble them
    Espruino.addProcessor("transformForEspruino", function(code, callback) {
      findASMBlocks(code, "", callback);
    });
    // When a module is sent to Espruino...
    Espruino.addProcessor("transformModuleForEspruino", function(module, callback) {
      findASMBlocks(module.code, " in "+module.name, function(code) {
        module.code = code;
        callback(module);
      });
    });
  }

  function assembleBlock(asmLines, description) {
    var machineCode = [];
    try {
      assemble(asmLines, function(word) { machineCode.push("0x"+word.toString(16)); });
    } catch (err) {
      logger.error("Assembler failed: "+err+description);
      Espruino.Core.Notifications.error("Assembler failed: "+err+description);
      return undefined;
    }

    return machineCode;
  }

  /* Finds instances of 'E.asm' and replaces them */
  function findASMBlocks(code, description, callback){

    function match(str, type) {
      if (str!==undefined && tok.str!=str) {
        Espruino.Core.Notifications.error("Expecting '"+str+"' but got '"+tok.str+description+"'. Should have E.asm('arg spec', 'asmline1', ..., 'asmline2'");
        return false;
      }
      if (type!==undefined && tok.type!=type) {
        Espruino.Core.Notifications.error("Expecting a "+type+" but got "+tok.type+description+". Should have E.asm('arg spec', 'asmline1', ..., 'asmline2'");
        return false;
      }
      tok = lex.next();
      return true;
    }

    var foundAsm = true;
    var assembledCode = "";
    var asmBlockCount = 1;
    while (foundAsm) {
      foundAsm = false;
      var lex = Espruino.Core.Utils.getLexer(code);
      var tok = lex.next();
      var state = 0;
      var startIndex = -1;
      while (tok!==undefined) {
        if (state==0 && tok.str=="E") { state=1; startIndex = tok.startIdx; tok = lex.next();
        } else if (state==1 && tok.str==".") { state=2; tok = lex.next();
        } else if (state==2 && (tok.str=="asm")) { state=3; tok = lex.next();
        } else if (state==3 && (tok.str=="(")) {
          foundAsm = true;
          state=0;
          tok = lex.next(); // skip (
          var argSpec = tok.value;
          var asmLines = [];
          if (!match(undefined,"STRING")) return;
          if (!match(",",undefined)) return;
          while (tok && tok.str!=")") {
            var lines = tok.value.split("\n");
            lines.forEach(function(l) {
              asmLines.push(l);
            });
            if (!match(undefined,"STRING")) return;
            if (tok.str!=")")
              if (!match(",",undefined)) return;
          }
          if (!match(")",undefined)) return;
          var endIndex = tok.endIdx;

          var machineCode = assembleBlock(asmLines, description);
          //console.log(machineCode);
          if (machineCode===undefined) return; // There was an error - just leave and don't try to flash
          var raw = "";
          machineCode.forEach(function(short) {
            var v = parseInt(short,16);
            raw += String.fromCharCode(v&255,v>>8);
          });
          var base64 = base64_encode(raw);
          code = code.substr(0,startIndex) +
                 'E.nativeCall(1, '+JSON.stringify(argSpec)+', atob('+JSON.stringify(base64)+'))'+
                 code.substr(endIndex);
          asmBlockCount++;

          // Break out
          tok = undefined;
        } else {
          state = 0;
          tok = lex.next();
        }
      }
    }

    if (assembledCode!="") {
      code = "var ASM_BASE=process.memory().stackEndAddress;\n"+
             assembledCode+
             code;
    }
    callback(code);
  };


  Espruino.Plugins.Assembler = {
    init : init,
  };
}());
