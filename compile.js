#!/usr/bin/node
// Very simple hack to test the code from node
//  sudo npm install -g acorn

var fs = require("fs");
var acorn = require("acorn");

var navigator = {
  userAgent : "X"
};      

var Espruino = eval(fs.readFileSync("espruino.js").toString());
eval(fs.readFileSync("core/utils.js").toString());
eval(fs.readFileSync("core/config.js").toString());
eval(fs.readFileSync("plugins/compiler.js").toString());
eval(fs.readFileSync("plugins/assembler.js").toString());

Espruino.Core.Notifications = console;
Espruino.Core.Env = {
  getBoardData : function() {
    return { EXPORT : ["jsvLock,jsvLockAgain,jsvUnLock,jsvMathsOp,jsvMathsOpSkipNames,"+
      "jsvNewFromFloat,jsvNewFromInteger,jsvNewFromString,jsvNewFromBool,"+
      "jsvGetFloat,jsvGetInteger,jsvGetBool,"+
      "jspeiFindInScopes,jspReplaceWith,", 536871028] };
  }
};

Espruino.init();

//var c = 'x=42;\nfunction f() { "compiled";return 1; }';
var c = 'i=4;\nfunction f() { "compiled";if (1); }';
//var c = "function f() {'compiled';iterations=0;while ((iterations<16) & ((Xr*Xr+Xi*Xi)<4)) { t=Xr*Xr - Xi*Xi + Cr;      Xi=2*Xr*Xi+Ci;      Xr=t;      iterations=iterations+1;    } return iterations;}";

Espruino.callProcessor("transformForEspruino",c, function(code) {
  console.log(code);
});

