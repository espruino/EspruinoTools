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
  if (chrome.serial.getDevices===undefined) {
    // wrong chrome version
    console.log("Chrome does NOT have post-M33 serial API");
    return;
  }  
  
  var connectionInfo;
  var connectedPort; // unused?
  var connectionDisconnectCallback;
  var connectionReadCallback;

  var getPorts=function(callback) {
    chrome.serial.getDevices(function(devices) {

      var prefix = "";
      // Workaround for Chrome v34 bug - http://forum.espruino.com/conversations/1056/#comment16121
      // In this case, ports are reported as ttyACM0 - not /dev/ttyACM0      
      if (navigator.userAgent.indexOf("Linux")>=0) {
        hasSlashes = false;
        devices.forEach(function(device) { if (device.path.indexOf("/")>=0) hasSlashes=true; });
        if (!hasSlashes) prefix = "/dev/";
      }

      callback(devices.map(function(device) {
        return {
                path : prefix+device.path, 
                description : device.displayName, 
                usb : [device.vendorId, device.productId]};
      }));
    });
  };
  
  var openSerial=function(serialPort, openCallback, receiveCallback, disconnectCallback) {
    connectionReadCallback = receiveCallback;
    connectionDisconnectCallback = disconnectCallback;
    chrome.serial.connect(serialPort, {bitrate: parseInt(Espruino.Config.BAUD_RATE)}, 
      function(cInfo) {
        if (!cInfo) {
          console.log("Unable to open device (connectionInfo="+cInfo+")");
          openCallback(undefined);
        } else {
          connectionInfo = cInfo;
          connectedPort = serialPort;
          console.log(cInfo);
          openCallback(cInfo);
        }        
    });
  };

  var str2ab=function(str) {
    var buf=new ArrayBuffer(str.length);
    var bufView=new Uint8Array(buf);
    for (var i=0; i<str.length; i++) {
      var ch = str.charCodeAt(i);
      if (ch>=256) {
        console.warn("Attempted to send non-8 bit character - code "+ch);
        ch = "?".charCodeAt(0);
      }
      bufView[i] = ch;
    }
    return buf;
  };
 
 
  var closeSerial=function() {
    if (connectionInfo)
      chrome.serial.disconnect(connectionInfo.connectionId, connectionDisconnectCallback);
    connectionReadCallback = undefined;
    connectionDisconnectCallback = undefined;
    connectionInfo=null;
  };
   
  var writeSerial = function(data, callback) {
    chrome.serial.send(connectionInfo.connectionId, str2ab(data), callback); 
  };
  
  // ----------------------------------------------------------
  chrome.serial.onReceive.addListener(function(receiveInfo) {
    if (connectionReadCallback!==undefined) 
      connectionReadCallback(receiveInfo.data);
  });

  chrome.serial.onReceiveError.addListener(function(errorInfo) {
    console.error("RECEIVE ERROR:", JSON.stringify(errorInfo));
    closeSerial();
  });

  Espruino.Core.Serial.devices.push({
    "getPorts": getPorts,
    "open": openSerial,
    "write": writeSerial,
    "close": closeSerial,
  });
})();
