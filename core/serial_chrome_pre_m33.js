/**
Copyright 2012 Google Inc.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

     http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.

Author: Renato Mangini (mangini@chromium.org)
Author: Luis Leao (luisleao@gmail.com)
Author: Gordon Williams (gw@pur3.co.uk)
**/

(function() {
  if (typeof chrome === 'undefined' || chrome.serial===undefined) return;
  if (chrome.serial.getPorts===undefined) {
    // wrong chrome version
    console.log("Chrome does NOT have pre-M33 serial API");
    return;
  } 
  
  var connectionInfo;
  var connectionReadCallback;
  var connectionDisconnectCallback;
  var connectionChecker;
  var connectedPort;

  /** When connected, this is called every so often to check on the state
   of the serial port. If it detects a disconnection it calls the disconnectCallback
   which will force a disconnect (which means that hopefulyl chrome won't hog the
   serial port if we physically reconnect the board). */
  var checkConnection = function() {
    chrome.serial.getControlSignals(connectionInfo.connectionId, function (sigs) { 
      var connected = "cts" in sigs;
      if (!connected) {
        console.log("Detected Disconnect");
        if (connectionDisconnectCallback!=undefined)
          connectionDisconnectCallback();
      }
   });
  };

  var onCharRead=function(readInfo) {
    if (!connectionInfo) return;
    if (readInfo && readInfo.bytesRead>0 && readInfo.data) {
      connectionReadCallback(readInfo.data);
    }
    chrome.serial.read(connectionInfo.connectionId, 1024, onCharRead);
  };

  var getPorts=function(callback) {
    chrome.serial.getPorts(function (ports) {
      callback(ports.map(function(path) { return { path : path }; }));
    });
  };
  
  var openSerial=function(serialPort, openCallback, receiveCallback, disconnectCallback) {
    connectionReadCallback = receiveCallback;
    connectionDisconnectCallback = disconnectCallback;
    chrome.serial.open(serialPort, {bitrate: 9600}, 
      function(cInfo) {
        if (!cInfo || !cInfo.connectionId || cInfo.connectionId<0) {
          console.log("Could not find device (connectionInfo="+cInfo+")");
          if (openCallback) openCallback(undefined);
        } else {
          connectionInfo=cInfo;
          connectedPort = serialPort;
          onCharRead();
          
          connectionChecker = setInterval(checkConnection, 500);          
          openCallback(cInfo);
        }        
    });
  };

  var str2ab=function(str) {
    var buf=new ArrayBuffer(str.length);
    var bufView=new Uint8Array(buf);
    for (var i=0; i<str.length; i++) {
      bufView[i]=str.charCodeAt(i);
    }
    return buf;
  };
 
 
  var closeSerial=function() {
   if (connectionChecker) {
     clearInterval(connectionChecker);
     connectedPort = undefined;
     connectionChecker = undefined;
   }
   chrome.serial.close(connectionInfo.connectionId, connectionDisconnectCallback);
   connectionReadCallback = undefined;
   connectionDisconnectCallback = undefined;
   connectionInfo=null;
  };

  var writeSerial = function(data, callback) {
    chrome.serial.write(connectionInfo.connectionId, str2ab(data), callback); 
  };

  Espruino.Core.Serial.devices.push({
    "getPorts": getPorts,
    "open": openSerial,
    "write": writeSerial,
    "close": closeSerial
  });
})();
