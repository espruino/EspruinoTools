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

  // For throttled write
  var slowWrite = true;
  var writeData = undefined;
  var writeInterval = undefined;

  var startListening = function(callback) {
    var oldListener = readListener;
    readListener = callback;
    return oldListener;
  };

  var getPorts = function(callback) {
    callback(['TCP port ' + parseInt(Espruino.Config.TCP_PORT)]);
  };
  
  var openSerial = function(serialPort, openCallback, disconnectCallback) {
    connectionDisconnectCallback = disconnectCallback;
    chrome.sockets.tcp.create({}, function(createInfo) {
      chrome.sockets.tcp.connect(createInfo.socketId,
          'localhost', parseInt(Espruino.Config.TCP_PORT), function (result) {
        if (result < 0) {
          console.log("Failed to open socket on port " + parseInt(Espruino.Config.TCP_PORT));
          openCallback(undefined);
        } else {
          connectionInfo = { socketId: createInfo.socketId };
          Espruino.callProcessor("connected", undefined, function() {
            openCallback(connectionInfo);
          });          
        }
      });
    });
  };

  var writeSerialDirect = function(str) {
    chrome.sockets.tcp.send(connectionInfo.socketId, str2ab(str), function() {});
  };

  var str2ab = function(str) {
    var buf=new ArrayBuffer(str.length);
    var bufView=new Uint8Array(buf);
    for (var i=0; i<str.length; i++) {
      bufView[i]=str.charCodeAt(i);
    }
    return buf;
  };
 
 
  var closeSerial = function(callback) {
    connectionDisconnectCallback = undefined;
    if (connectionInfo) {
      chrome.sockets.tcp.disconnect(connectionInfo.socketId,
        function () {
        connectionInfo=null;
        Espruino.callProcessor("disconnected");
        if (callback) callback();
      });
    }
  };
   
  var isConnected = function() {
    return connectionInfo!=null && connectionInfo.socketId>=0;
  };

  // Throttled serial write
  var writeSerial = function(data, showStatus) {
    if (!isConnected()) return; // throw data away
    if (showStatus===undefined) showStatus=true;
    
    /* Here we queue data up to write out. We do this slowly because somehow 
    characters get lost otherwise (compared to if we used other terminal apps
    like minicom) */
    if (writeData == undefined)
      writeData = data;
    else
      writeData += data;    
    
    var blockSize = slowWrite ? 30 : 512; // not sure how, but v33 serial API seems to lose stuff if we don't sent it at once

    showStatus &= writeData.length>blockSize;
    if (showStatus) {
      Espruino.Core.Status.setStatus("Sending...", writeData.length);
      console.log("---> "+JSON.stringify(data));
    }

    if (writeInterval===undefined) {
      function sender() {
        if (writeData!=undefined) {
          var d = undefined;
          if (writeData.length>blockSize) {
            d = writeData.substr(0,blockSize);
            writeData = writeData.substr(blockSize);
          } else {
            d = writeData;
            writeData = undefined; 
          }          
          writeSerialDirect(d);
          if (showStatus) 
            Espruino.Core.Status.incrementProgress(d.length);
        } 
        if (writeData==undefined && writeInterval!=undefined) {
          clearInterval(writeInterval);
          writeInterval = undefined;
          if (showStatus) 
            Espruino.Core.Status.setStatus("Sent");
        }
      }
      sender(); // send data instantly
      // if there was any more left, do it after a delay
      if (writeData!=undefined) {
        writeInterval = setInterval(sender, 100);
      } else {
        if (showStatus)
          Espruino.Core.Status.setStatus("Sent");
      }
    }
  };

  // ----------------------------------------------------------
  chrome.sockets.tcp.onReceive.addListener(function(info) {
    if (info.socketId != connectionInfo.socketId)
      return;
    if (readListener!==undefined) readListener(info.data);
  });

  chrome.sockets.tcp.onReceiveError.addListener(function(info) {
    if (info.socketId != connectionInfo.socketId)
      return;
    console.log("RECEIVE ERROR:", JSON.stringify(info));
    connectionDisconnectCallback();
  });

  Espruino.Core.Serial = {
    "init" : init,
    "getPorts": getPorts,
    "open": openSerial,
    "isConnected": isConnected,
    "startListening": startListening,
    "write": writeSerial,
    "close": closeSerial,
	"isSlowWrite": function() { return slowWrite; },
	"setSlowWrite": function(isOn, force) { 
        if ((!force) && Espruino.Config.SERIAL_THROTTLE_SEND) {
          console.log("ForceThrottle option is set - set Slow Write = true");
          isOn = true;
        } else
  	    console.log("Set Slow Write = "+isOn);
	  slowWrite = isOn; 
	},
  };
})();
