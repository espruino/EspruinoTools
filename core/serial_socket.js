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
  if (typeof chrome === 'undefined' || chrome.sockets===undefined) {
    console.log("No chrome.sockets - serial_socket disabled");
    return;
  }

  function init() {
    Espruino.Core.Config.add("SERIAL_TCPIP", {
      section : "Communications",
      name : "Connect over TCP Address",
      description : "When connecting, add a menu item to connect to a given TCP/IP address (eg. `192.168.1.2` or `192.168.1.2:23`). Leave blank to disable. Separate multiple ip addresses with a semi-colon.",
      type : "string",
      defaultValue : "", 
    });
  }  
  
  var connectionInfo;
  var readListener;
  var connectionDisconnectCallback;
  var connectionReadCallback;  

  var getPorts = function(callback) {
    if (Espruino.Config.SERIAL_TCPIP.trim() != "") {      
      var ips = Espruino.Config.SERIAL_TCPIP.trim().split(";");
      var portList = [];
      ips.forEach(function(s) { 
        s = s.trim();
        if (s.length) portList.push({path:'TCP/IP: '+s, description:"Network connection"}); 
      })
      callback(portList);
    } else
      callback();
  };
  
  var openSerial=function(serialPort, openCallback, receiveCallback, disconnectCallback) {
    if (serialPort.substr(0,8)!='TCP/IP: ') {
      console.error("Invalid connection "+JSON.stringify(serialPort));
      return;
    }
    var host = serialPort.substr(8);
    var port = 23;
    if (host.indexOf(":") >= 0) {
      var i = host.indexOf(":");
      port = parseInt(host.substr(i+1).trim());
      host = host.substr(0,i).trim();
      if (host=="") host="localhost";
    }

    connectionReadCallback = receiveCallback;
    connectionDisconnectCallback = disconnectCallback;
    chrome.sockets.tcp.create({}, function(createInfo) {
      chrome.sockets.tcp.connect(createInfo.socketId,
          host, port, function (result) {
        if (result < 0) {
          console.log("Failed to open socket " + host+":"+port);
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
    if (connectionInfo) {
      chrome.sockets.tcp.disconnect(connectionInfo.socketId,
        function () {
          connectionInfo=null;
          connectionDisconnectCallback();
          connectionDisconnectCallback = undefined;
      });
    }
  };

  var writeSerial = function(data, callback) {
    chrome.sockets.tcp.send(connectionInfo.socketId, str2ab(data), callback);
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
