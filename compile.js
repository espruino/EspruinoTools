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
eval(fs.readFileSync("plugins/assembler.js").toString());
eval(fs.readFileSync("plugins/compiler.js").toString());

Espruino.Core.Notifications = console;

Espruino.init();

Espruino.callProcessor("transformForEspruino",'function a(b) { "compiled";return b+1; }', function(code) {
  console.log(code);
});

