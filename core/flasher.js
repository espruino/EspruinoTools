/**
 Copyright 2014 Gordon Williams (gw@pur3.co.uk)

 This Source Code is subject to the terms of the Mozilla Public
 License, v2.0. If a copy of the MPL was not distributed with this
 file, You can obtain one at http://mozilla.org/MPL/2.0/.

 ------------------------------------------------------------------
  Actual low-level code for flashing Espruino Devices
 ------------------------------------------------------------------
**/
"use strict";
(function(){

  var dataReceived = undefined; // listener for when data is received
  var bytesReceived = []; // list of characters for when no handler is specified

  var ACK = 0x79;
  var NACK = 0x1F;
  var DEFAULT_FLASH_OFFSET = 1024*10; /* Skip size of F1 bootloader by default */

  var setStatus = function() {};

  function init() {
  }

  var initialiseChip = function(callback, timeout) {
    setStatus("Initialising...");
    var iTimeout = setTimeout(function() {
      dataReceived = undefined;
      clearInterval(iPoll);
      //callback("Can't find STM32 bootloader. Make sure the chip is reset with BOOT0=1 and BOOT1=0");
      callback("Can't find STM32 bootloader. Make sure the chip is reset into bootloader mode by holding down BTN1 while pressing RST");
    }, (timeout==undefined)?10000:timeout);
    var iPoll = setInterval(function() {
      console.log("Sending... 0x7F");
      Espruino.Core.Serial.write("\x7f", false);
    }, 70);
    dataReceived = function (c) {
      console.log("got "+c);
      if (c==ACK || c==NACK) {
        clearTimeout(iTimeout);
        clearInterval(iPoll);
        setStatus("Initialised.");
        // wait for random extra data...
        dataReceived = function(c){
          console.log("Already ACKed but got "+c);
        };
        setTimeout(function() {
          dataReceived = undefined;
          // finally call callback
          bodgeClock(callback);
        }, 500);
      }
    };
  };

  var waitForACK = function(callback, timeout) {
    var ms = timeout?timeout:1000;
    var iTimeout = setTimeout(function() {
      dataReceived = undefined;
      callback("Timeout waiting for ACK - "+ms+"ms");
    }, ms);
    dataReceived = function (c) {
      //console.log("Got data "+JSON.stringify(c));
      dataReceived = undefined;
      if (c==ACK) {
        clearTimeout(iTimeout);
        callback(undefined);
      } else
        callback("Expected ACK but got "+c);
    };
  };

  var sendData = function(data, callback, timeout) {
    var s = "";
    var chksum = 0;
    for (var i in data) {
      chksum = chksum ^ data[i];
      s += String.fromCharCode(data[i]);
    }
    Espruino.Core.Serial.write(s + String.fromCharCode(chksum), false);
    /* wait for ACK *NOW* - not in the write callback, as by that time we
    may have already received the ACK we were looking for */
    waitForACK(callback, timeout);
  };

  var receiveData = function(count, callback, timeout) {
    var data = new Uint8Array(count);
    var dataCount = 0;
    var iTimeout = setTimeout(function() {
      dataReceived = undefined;
      callback("Timeout reading "+count+" bytes");
    }, timeout?timeout:2000);
    dataReceived = function (c) {
      data[dataCount++] = c;
      if (dataCount == count) {
        clearTimeout(iTimeout);
        dataReceived = undefined;
        callback(undefined,data);
      }
    };
  };

  var sendCommand = function(command, callback) {
    Espruino.Core.Serial.write(String.fromCharCode(command) + String.fromCharCode(0xFF ^ command), false);
    /* wait for ACK *NOW* - not in the write callback, as by that time we
    may have already received the ACK we were looking for */
    waitForACK(callback);
  };

  var eraseChip = function(callback) {
    Espruino.Core.Status.setStatus("Erasing...");
    // Extended erase
    sendCommand(0x44, function(err) {
      if (err) { callback(err); return; }
      console.log("We may be some time...");
      sendData([0xFF,0xFF], function(err) {
        if (err) { callback(err); return; }
        callback(undefined);
      }, 20000/*timeout*/);
    });
  };

  var readData = function(callback, addr, readBytes) {
    console.log("Reading "+readBytes+" bytes from 0x"+addr.toString(16)+"...");
    // send read command
    sendCommand(0x11, function(err) {
      if (err) {
        console.log("Error sending command ("+err+").");
        callback(err);
        return;
      }
      // send address
      sendData([(addr>>24)&0xFF,(addr>>16)&0xFF,(addr>>8)&0xFF,addr&0xFF], function(err) {
        if (err) {
          console.log("Error sending address. ("+err+")");
          callback(err);
          return;
        }
        // send amount of bytes we want
        sendData([readBytes-1], function(err) {
          if (err) {
            console.log("Error while reading. ("+err+")");
            callback(err);
            return;
          }
          receiveData(readBytes, /*function(err) {
            if (err) {
              console.log("Error while reading. retrying...");
              initialiseChip(function (err) {
                if (err) callback(err);
                else readData(callback, addr, readBytes);
              }, 10000);
              return;
            }
            callback(undefined, data);
          }*/callback, 1000);
        }, 2000/*timeout*/);
      });
    });
  };

  var bodgeClock = function(callback) {
    /* 1v43 bootloader ran APB1 at 9Mhz, which isn't enough for
    some STM32 silicon, which has a bug. Instead, set the APB1 clock
    using the bootloader write command, which will fix it up enough for
    flashing.   */
    var RCC_CFGR = 0x40021004;
    readData(function(err, data) {
      if (err) return callback(err);
      var word = (data[3]<<24) | (data[2]<<16) | (data[1]<<8) | data[0];
      console.log("RCC->CFGR = "+word);
      var newword = (word&0xFFFFF8FF) | 0x00000400;
      if (newword==word) {
        console.log("RCC->CFGR is correct");
        callback(undefined);
      } else {
        console.log("Setting RCC->CFGR to "+newword);
        writeData(callback, RCC_CFGR, [newword&0xFF, (newword>>8)&0xFF, (newword>>16)&0xFF, (newword>>24)&0xFF]);
      }
    }, RCC_CFGR, 4);
  };

  var writeData = function(callback, addr, data) {
    if (data.length>256) callback("Writing too much data");
    console.log("Writing "+data.length+" bytes at 0x"+addr.toString(16)+"...");
    // send write command
    sendCommand(0x31, function(err) {
      if (err) {
        console.log("Error sending command ("+err+"). retrying...");
        initialiseChip(function (err) {
          if (err) callback(err);
          else writeData(callback, addr, data);
        }, 30000);
        return;
      }
      // send address
      sendData([(addr>>24)&0xFF,(addr>>16)&0xFF,(addr>>8)&0xFF,addr&0xFF], function(err) {
        if (err) {
          console.log("Error sending address ("+err+"). retrying...");
          initialiseChip(function (err) {
            if (err) callback(err);
            else writeData(callback, addr, data);
          }, 30000);
          return;
        }
        // work out data to send
        var sData = [ data.length-1 ];
        // for (var i in data) doesn't just do 0..data.length-1 in node!
        for (var i=0;i<data.length;i++) sData.push(data[i]&0xFF);
        // send data
        sendData(sData, function(err) {
          if (err) {
            console.log("Error while writing ("+err+"). retrying...");
            initialiseChip(function (err) {
              if (err) callback(err);
              else writeData(callback, addr, data);
            }, 30000);
            return;
          }
          callback(undefined); // done
        }, 2000/*timeout*/);
      });
    });
  };

  var writeAllData = function(binary, flashOffset, callback) {
    var chunkSize = 256;
    console.log("Writing "+binary.byteLength+" bytes");
    Espruino.Core.Status.setStatus("Writing flash...",  binary.byteLength);
    var writer = function(offset) {
      if (offset>=binary.byteLength) {
        Espruino.Core.Status.setStatus("Write complete!");
        callback(undefined); // done
        return;
      }
      var len = binary.byteLength - offset;
      if (len > chunkSize) len = chunkSize;
      var data = new Uint8Array(binary, offset, len);
      writeData(function(err) {
        if (err) { callback(err); return; }
        Espruino.Core.Status.incrementProgress(chunkSize);
        writer(offset + chunkSize);
      }, 0x08000000 + offset, data);
    };
    writer(flashOffset);
  };

  var readAllData = function(binaryLength, flashOffset, callback) {
    var data = new Uint8Array(flashOffset);
    var chunkSize = 256;
    console.log("Reading "+binaryLength+" bytes");
    Espruino.Core.Status.setStatus("Reading flash...",  binaryLength);
    var reader = function(offset) {
      if (offset>=binaryLength) {
        Espruino.Core.Status.setStatus("Read complete!");
        callback(undefined, data); // done
        return;
      }
      var len = binaryLength - offset;
      if (len > chunkSize) len = chunkSize;
      readData(function(err, dataChunk) {
        if (err) { callback(err); return; }
        for (var i in dataChunk)
          data[offset+i] = dataChunk[i];
        Espruino.Core.Status.incrementProgress(chunkSize);
        reader(offset + chunkSize);
      }, 0x08000000 + offset, chunkSize);
    };
    reader(flashOffset);
  };

  function flashBinaryToDevice(binary, flashOffset, callback, statusCallback) {
    setStatus = function(x) {
      if (!Espruino.Core.Status.hasProgress())
        Espruino.Core.Status.setStatus(x);
      if (statusCallback) statusCallback(x);
    }
    if (typeof flashOffset === 'function') {
      // backward compatibility if flashOffset is missed
      callback = flashOffset;
      flashOffset = null;
    }

    if (!flashOffset && flashOffset !== 0) {
      flashOffset = DEFAULT_FLASH_OFFSET;
    }

    if (typeof binary == "string") {
      var buf = new ArrayBuffer(binary.length);
      var a = new Uint8Array(buf);
      for (var i=0;i<binary.length;i++)
        a[i] = binary.charCodeAt(i);
      binary = buf;
    }
    // add serial listener
    dataReceived = undefined;
    Espruino.Core.Serial.startListening(function (readData) {
      var bufView=new Uint8Array(readData);
      //console.log("Got "+bufView.length+" bytes");
      for (var i=0;i<bufView.length;i++) bytesReceived.push(bufView[i]);
      if (dataReceived!==undefined) {
        for (var i=0;i<bytesReceived.length;i++) {
          if (dataReceived===undefined) console.log("OH NO!");
          dataReceived(bytesReceived[i]);
        }
        bytesReceived = [];
      }
    });
    Espruino.Core.Serial.setBinary(true);
    var hadSlowWrite = Espruino.Core.Serial.isSlowWrite();
    Espruino.Core.Serial.setSlowWrite(false, true/*force*/);
    var oldHandler;
    if (Espruino.Core.Terminal) {
      oldHandler = Espruino.Core.Terminal.setInputDataHandler(function() {
        // ignore keyPress from terminal during flashing
      });
    }
    var finish = function(err) {
      Espruino.Core.Serial.setSlowWrite(hadSlowWrite);
      Espruino.Core.Serial.setBinary(false);
      if (Espruino.Core.Terminal)
        Espruino.Core.Terminal.setInputDataHandler(oldHandler);
      callback(err);
    };
    // initialise
    initialiseChip(function (err) {
      if (err) { finish(err); return; }
      setStatus("Erasing...");
      eraseChip(function (err) {
        if (err) { finish(err); return; }
        setStatus("Writing Firmware...");
        writeAllData(binary, flashOffset, function (err) {
          if (err) { finish(err); return; }
          finish();
        });
      });
      /*readAllData(binary.byteLength, function(err,chipData) {
        if (err) {
          finish(err);
          return;
        }
        var errors = 0;
        var needsErase = false;
        var binaryData = new Uint8Array(binary, 0, binary.byteLength);
        for (var i=FLASH_OFFSET;i<binary.byteLength;i++) {
          if (binaryData[i]!=chipData[i]) {
            if (chipData[i]!=0xFF) needsErase = true;
            console.log(binaryData[i]+" vs "+data[i]);
            errors++;
          }
        }
        console.log(errors+" differences, "+(needsErase?"needs erase":"doesn't need erase"));
      });*/
    });
  }

  function flashDevice(url, flashOffset, callback, statusCallback) {
    Espruino.Core.Utils.getBinaryURL(url, function (err, binary) {
      if (err) { callback(err); return; }
      console.log("Downloaded "+binary.byteLength+" bytes");
      flashBinaryToDevice(binary, flashOffset, callback, statusCallback);
    });
  };


  function resetDevice(callback) {
    // add serial listener
    dataReceived = undefined;
    Espruino.Core.Serial.startListening(function (readData) {
      var bufView=new Uint8Array(readData);
      //console.log("Got "+bufView.length+" bytes");
      for (var i=0;i<bufView.length;i++) bytesReceived.push(bufView[i]);
      if (dataReceived!==undefined) {
        for (var i=0;i<bytesReceived.length;i++) {
          if (dataReceived===undefined) console.log("OH NO!");
          dataReceived(bytesReceived[i]);
        }
        bytesReceived = [];
      }
    });
    Espruino.Core.Serial.setBinary(true);
    var hadSlowWrite = Espruino.Core.Serial.isSlowWrite();
    Espruino.Core.Serial.setSlowWrite(false, true/*force*/);
    var oldHandler = Espruino.Core.Terminal.setInputDataHandler(function() {
      // ignore keyPress from terminal during flashing
    });
    var finish = function(err) {
      Espruino.Core.Serial.setSlowWrite(hadSlowWrite);
      Espruino.Core.Serial.setBinary(false);
      Espruino.Core.Terminal.setInputDataHandler(oldHandler);
      callback(err);
    };
    // initialise
    initialiseChip(function (err) {
      if (err) return finish(err);
      var data = new Uint8Array([0x04,0x00,0xFA,0x05]);
      var addr = 0xE000ED0C;
      console.log("Writing "+data.length+" bytes at 0x"+addr.toString(16)+"...");
      // send write command
      sendCommand(0x31, function(err) {
        if (err) return finish(err);
        // send address
        sendData([(addr>>24)&0xFF,(addr>>16)&0xFF,(addr>>8)&0xFF,addr&0xFF], function(err) {
          if (err) return finish(err);
          // work out data to send
          // for (var i in data) doesn't just do 0..data.length-1 in node!
          for (var i=0;i<data.length;i++) sData.push(data[i]&0xFF);
          var s = "";
          var chksum = 0;
          for (var i in sData) {
            chksum = chksum ^ sData[i];
            s += String.fromCharCode(sData[i]);
          }
          Espruino.Core.Serial.write(s + String.fromCharCode(chksum), false, finish);
        }, 2000/*timeout*/);
      });
    });
  };



  Espruino.Core.Flasher = {
    init : init,
    flashDevice : flashDevice,
    flashBinaryToDevice : flashBinaryToDevice,
    resetDevice : resetDevice
  };
}());
