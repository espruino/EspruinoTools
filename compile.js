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

Espruino.init();

Espruino.callProcessor("transformForEspruino",'console.log("Hello");\nfunction a(b) { "compiled";return b+1; }\nconsole.log("World")', function(code) {
  console.log(code);
});

