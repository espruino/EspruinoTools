#!/usr/bin/node
// Very simple hack to test the code from node
//  sudo npm install -g acorn

var fs = require("fs");
var acorn = require("acorn");
acorn.walk = require("acorn/util/walk");

var navigator = {
  userAgent : "X"
};      

var Espruino = eval(fs.readFileSync("espruino.js").toString());
eval(fs.readFileSync("core/utils.js").toString());
eval(fs.readFileSync("core/config.js").toString());
eval(fs.readFileSync("plugins/compiler.js").toString());
eval(fs.readFileSync("plugins/assembler.js").toString());

Espruino.Core.Notifications = {
    log : function(s) { console.log(s); },
    warning : function(s) { console.warn(s); },
    error : function(s) { console.error(s); }
};
Espruino.Core.Env = {
  getBoardData : function() {
    return { EXPORT : ["jsvLock,jsvLockAgainSafe,jsvUnLock,jsvMathsOp,jsvMathsOpSkipNames,"+
      "jsvNewFromFloat,jsvNewFromInteger,jsvNewFromString,jsvNewFromBool,"+
      "jsvGetFloat,jsvGetInteger,jsvGetBool,jsvSkipName,"+
      "jspeiFindInScopes,jspReplaceWith,", 536871028] };
  }
};

Espruino.init();

var c = 'function f(a,b) { "compiled";var s;return b; }';
//var c = 'x=42;\nfunction f() { "compiled";return 1; }';
//var c = '"Hello";function f() { "compiled";return 1; }"There";function g() { "compiled";return 2; }"World"';
//var c = "function f() {'compiled';iterations=0;while ((iterations<16) & ((Xr*Xr+Xi*Xi)<4)) { t=Xr*Xr - Xi*Xi + Cr;      Xi=2*Xr*Xi+Ci;      Xr=t;      iterations=iterations+1;    } return iterations;}";

Espruino.callProcessor("transformForEspruino",c, function(code) {
  console.log(code);
});

