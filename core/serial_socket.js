/**
Copyright (c) 2014 Espruino Project

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

     http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.

Author: Patrick Van Oosterwijck (patrick@silicognition.com)
**/

(function() {
  if (typeof chrome === 'undefined' || chrome.sockets===undefined) return;

  function init() {
    Espruino.Core.Config.add("TCP_PORT", {
      section : "Communications",
      name : "TCP port",
      description : "When connecting to a TCP socket, use this port",
      defaultValue : 10191, 
    });
  }  
  
  var connectionInfo;
  var readListener;
  var connectionDisconnectCallback;
  var connectionReadCallback;  

  var getPorts = function(callback) {
    callback(['TCP port ' + parseInt(Espruino.Config.TCP_PORT)]);
  };
  
  var openSerial=function(serialPort, openCallback, receiveCallback, disconnectCallback) {
    connectionReadCallback = receiveCallback;
    connectionDisconnectCallback = disconnectCallback;
    chrome.sockets.tcp.create({}, function(createInfo) {
      chrome.sockets.tcp.connect(createInfo.socketId,
          'localhost', parseInt(Espruino.Config.TCP_PORT), function (result) {
        if (result < 0) {
          console.log("Failed to open socket on port " + parseInt(Espruino.Config.TCP_PORT));
          openCallback(undefined);
        } else {
          connectionInfo = { socketId: createInfo.socketId };
          openCallback(connectionInfo);
        }
      });
    });
  };

  var str2ab = function(str) {
    var buf=new ArrayBuffer(str.length);
    var bufView=new Uint8Array(buf);
    for (var i=0; i<str.length; i++) {
      bufView[i]=str.charCodeAt(i);
    }
    return buf;
  };
 
 
  var closeSerial = function() {
    connectionDisconnectCallback = undefined;
    if (connectionInfo) {
      chrome.sockets.tcp.disconnect(connectionInfo.socketId,
        function () {
          connectionInfo=null;
          connectionDisconnectCallback();
          connectionDisconnectCallback = undefinedl
      });
    }
  };

  var writeSerial = function(data, callback) {
    chrome.sockets.tcp.send(connectionInfo.socketId, str2ab(str), callback);
  };

  // ----------------------------------------------------------
  chrome.sockets.tcp.onReceive.addListener(function(info) {
    if (info.socketId != connectionInfo.socketId)
      return;
    if (connectionReadCallback!==undefined) 
      connectionReadCallback(info.data);
  });

  chrome.sockets.tcp.onReceiveError.addListener(function(info) {
    if (info.socketId != connectionInfo.socketId)
      return;
    console.error("RECEIVE ERROR:", JSON.stringify(info));
    connectionDisconnectCallback();
  });

  Espruino.Core.Serial.devices.push({
    "init" : init,
    "getPorts": getPorts,
    "open": openSerial,
    "write": writeSerial,
    "close": closeSerial,
  });
})();
