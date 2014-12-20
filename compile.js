#!/bin/node
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
    return { EXPORT : ["jsvLock,jsvUnLock,jsvMathsOp,"+
      "jsvNewFromFloat,jsvNewFromInteger,jsvNewFromString,jsvNewFromBool,"+
      "jsvGetFloat,jsvGetInteger,jsvGetBool,"+
      "jspeiFindInScopes,jspReplaceWith,", 536871028] };
  }
};

Espruino.init();

Espruino.callProcessor("transformForEspruino",'console.log("Hello");\nfunction a(b) { "compiled";return b+"World"; }\nconsole.log("World")', function(code) {
  console.log(code);
});

