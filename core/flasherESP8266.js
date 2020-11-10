/**
 Copyright 2020 Gordon Williams (gw@pur3.co.uk)

 This Source Code is subject to the terms of the Mozilla Public
 License, v2.0. If a copy of the MPL was not distributed with this
 file, You can obtain one at http://mozilla.org/MPL/2.0/.

 ------------------------------------------------------------------
  Firmware updater for ESP8266 in Espruino WiFi
 ------------------------------------------------------------------
**/
"use strict";
(function(){

  const BLOCK_SIZE = 0x400;
  var uart;
  var uartLine = "";
  var packetHandler;


  function init() {
  }

  /* options = {
    binary : ArrayBuffer,
    cbStatus,
    cbDone */
  function flashDevice(options) {
    if (!options.binary) throw new Error("Needs binary");

    Espruino.Core.Serial.startListening(function (buffer) {
      var bufView = new Uint8Array(buffer);
      for (var i=0;i<bufView.length;i++)
        uartLine += String.fromCharCode(bufView[i]);
      var l = uartLine.split("\n");
        while(l.length>1) {
          var a = l.shift();
          console.log(">>>",a);
          try {
          if (packetHandler) packetHandler(JSON.parse(a));
          } catch(e) { console.log("Unable to decode"); }
        }
        uartLine = l[0];
    });
    Espruino.Core.Serial.setBinary(true);
    var hadSlowWrite = Espruino.Core.Serial.isSlowWrite();
    Espruino.Core.Serial.setSlowWrite(false, true/*force*/);
    var oldHandler = Espruino.Core.Terminal.setInputDataHandler(function() {
      // ignore keyPress from terminal during flashing
    });
    function finish() {
      Espruino.Core.Serial.setSlowWrite(hadSlowWrite);
      Espruino.Core.Serial.setBinary(false);
      Espruino.Core.Terminal.setInputDataHandler(oldHandler);
      Espruino.Core.Serial.close();
    }

    setupEspruino(options).
    then(()=>cmdSync(options)).
    then(() => cmdFlash(options)).
    then(() => unsetupEspruino(options)).
    then(function() {
      console.log("Complete!");
      finish();
      if (options.cbDone) options.cbDone();
    }).catch(function(error) {
      console.log("Error!", error);
      finish();
      if (options.cbDone) options.cbDone();
    });
  }


function wr(cmd,data) {
  //console.log("Write",cmd,data.length,data);
  if (typeof data !== "string")
    data = String.fromCharCode.apply(null,data);
  // calculate crc
  var crc = 0xEF;
  for (var i=(cmd==3)?16:0;i<data.length;i++) crc^=data.charCodeAt(i);
  // do packet
  var pk = String.fromCharCode(0,cmd, data.length&255, data.length>>8, crc,0,0,0) + data;
  pk = pk.replace(/\xDB/g,"\xDB\xDD").replace(/\xC0/g,"\xDB\xDC");
  pk = "\xC0"+pk+"\xC0";
  //console.log("OUT: ",pk.length,pk.split("").map(x=>x.charCodeAt().toString(16).padStart(2,'0')).join(" "));
  Espruino.Core.Serial.write(`\x10n="${Espruino.Core.Utils.btoa(pk)}";Serial2.write(atob(n))\n`, false);
}

function sendCmd(cmd, data) {
  return new Promise((resolve,reject)=>{
    wr(cmd, data);
    packetHandler = function(d) {
      //console.log(d);
      packetHandler = undefined;
      if (d.cmd==cmd && d.data.charCodeAt(0)==0) resolve();
      else reject("Unexpected response "+JSON.stringify(d));
    };
  });
}

function setupEspruino(options) {
  if (options.cbStatus) options.cbStatus("Configuring Espruino...");
  return new Promise((resolve,reject)=>{
    Espruino.Core.Serial.write('\x03\x10reset()\n', false, function() {
      setTimeout(function() {
          console.log("Start Wifi, add handler");
          Espruino.Core.Serial.write(`\x10Serial2.setup(74880, { rx: A3, tx : A2 });
\x10var packetHandler, packetData="";
\x10Serial2.on('data', function(d) {
  packetData+=d;
  if (packetData[0]!="\\xc0") {
    var i = packetData.indexOf("\\xc0");
    if (i>0) packetData=packetData.substr(i);
  }
  while (packetData[0]=="\\xc0") {
    var e = packetData.indexOf("\\xc0",1);
    if (e<0) break;
    var packet = packetData.substr(1,e-1);
    var len = packet.charCodeAt(2)|(packet.charCodeAt(3)<<8);
    USB.println(JSON.stringify({
      dir : packet.charCodeAt(0),
      cmd : packet.charCodeAt(1),
      len: len,
      data: packet.substr(8, len)
    }));
    packetData=packetData.substr(e+1);
  }
});
\x10digitalWrite(A14, 0); // make sure WiFi starts off
\x10digitalWrite(A13, 0); // into of boot mode
\x10digitalWrite(A14, 1); // turn on wifi
`, false, function() {
            console.log("Handler added");
            resolve();
          });
        }, 1000);
    });
  });
}

function unsetupEspruino(options) {
  if (options.cbStatus) options.cbStatus("Resetting Espruino...");
  return new Promise((resolve,reject)=>{
    Espruino.Core.Serial.write('\x03\x10reset()\n', false, function() {
      setTimeout(function() {
        resolve();
      }, 1000);
    });
  });
}

function cmdSync(options) {
  console.log("Syncing...");
  return new Promise((resolve,reject)=>{
    var success = false;
    var interval;
    packetHandler = function(d) {
      if (d.cmd==8) {
        if (interval) {
          clearInterval(interval);
          interval = undefined;
        }
        packetHandler = undefined;
        console.log("Sync complete!");
        setTimeout(function() {
          // allow time for other responses
          resolve();
        }, 500);
      }
    }
    var tries = 5;
    interval = setInterval(function() {
      if (tries-- <= 0) {
        clearInterval(interval);
        return reject("No response to sync");
      }
      if (options.cbStatus) options.cbStatus("Syncing...");
      var d = new Uint8Array(36);
      d.fill(0x55);
      d.set([0x07,0x07,0x12,0x20]);
      wr(8 /* SYNC */, d);
    }, 500);
  });
}



function cmdFlash(options) {
  var binary = new Uint8Array(options.binary);
  var blockCount = Math.floor((binary.length + (BLOCK_SIZE-1)) / BLOCK_SIZE);
  console.log(`Start Flashing, ${blockCount} blocks of ${BLOCK_SIZE} bytes`);
  var d = new Uint32Array([
    blockCount*BLOCK_SIZE, // erase size
    blockCount, // # packets
    BLOCK_SIZE, // bytes per packet
    0 // flash offset
  ]);
  var idx = 0;
  return sendCmd(2 /* FLASH_BEGIN */, new Uint8Array(d.buffer)).then(function flash() {
    console.log("Block "+idx);
    if (options.cbStatus) options.cbStatus(`Writing Block ${idx} / ${blockCount}`, idx / blockCount);
    if (idx>=blockCount) return true;
    d = new Uint8Array(16 + BLOCK_SIZE);
    d.fill(255);
    (new Uint32Array(d.buffer)).set([
      BLOCK_SIZE, // data size
      idx, // sequence
      0,0
    ]);
    d.set(new Uint8Array(binary.buffer, BLOCK_SIZE*idx, BLOCK_SIZE), 16);
    idx++;
    return sendCmd(3 /* FLASH_DATA */, d).then(flash);
  });
}

function getFirmwareVersion(callback) {
  Espruino.Core.Serial.write('\x03\x10reset()\n', false, function() {
    setTimeout(function() {
      Espruino.Core.Serial.write(`\x10digitalWrite(A14, 0);/*WiFi off*/digitalWrite(A13, 1);/*no boot*/digitalWrite(A14, 1);/*WiFi On*/\n`, false, function() {
        setTimeout(function() {
          var result = "";
          Espruino.Core.Serial.startListening(function (buffer) {
            var bufView = new Uint8Array(buffer);
            for (var i=0;i<bufView.length;i++)
              result += String.fromCharCode(bufView[i]);
          });
          Espruino.Core.Serial.write(`\x10Serial2.pipe(USB);Serial2.setup(115200, { rx: A3, tx : A2 });Serial2.print("AT+GMR\\r\\n");\n`, false, function() {
            setTimeout(function() {
              Espruino.Core.Serial.write('\x03\x10reset()\n', false, function() {
                callback(result.trim());
              });
            }, 500);
          });
        }, 500);
      });
    }, 500);
  });
}

  Espruino.Core.FlasherESP8266 = {
    init : init,
    flashDevice : flashDevice,
    getFirmwareVersion : getFirmwareVersion,
  };
}());
