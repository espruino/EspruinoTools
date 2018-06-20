/**
Copyright (c) 2018 Espruino Project

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

     http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.

Author: Alfie Kirkpatrick (jugglingcats@akirkpatrick.com)
**/

(function () {
  var PREFIX = "tcp://"; // prefix to use with -p option for hostname/ip address

  if (typeof require === 'undefined') return; // definitely not node!

  var net;
  try {
    net = require("net");
  } catch (e) {
    console.log("Require net failed - Node Socket disabled");
    return;
  }

  var socket;

  var getPorts = function (callback) {
    var config=Espruino.Config.SERIAL_TCPIP;
    if ( config && config.length ) {
      callback(config.map(function(p) {
        return { path: p, description: "Network connection", type: "socket" };
      }), true/*instantPorts*/);
    } else
      callback(undefined, true/*instantPorts*/);
  };

  var openSerial = function (serialPort, openCallback, receiveCallback, disconnectCallback) {
    if (serialPort.substr(0, 6) != 'tcp://') {
      console.error("Invalid connection " + JSON.stringify(serialPort));
      return;
    }
    var host = serialPort.substr(6);
    var port = 23;
    if (host.indexOf(":") >= 0) {
      var i = host.indexOf(":");
      port = parseInt(host.substr(i + 1).trim());
      host = host.substr(0, i).trim();
      if (host == "") host = "localhost";
    }

    socket = net.createConnection(port, host, function (createInfo) {
      openCallback("Ok");
    });
    socket.on("data", function (data) {
      if (receiveCallback !== undefined) {
        var a = new Uint8Array(data.length);
        for (var i = 0; i < data.length; i++)
          a[i] = data[i];
        receiveCallback(a.buffer);
      }
    });
    socket.on("error", function (info) {
      console.error("RECEIVE ERROR:", JSON.stringify(info));
      // node will close the connection
    });
    socket.on("end", function () {
      if (disconnectCallback !== undefined) {
        disconnectCallback();
      }
    });
  };

  var closeSerial = function () {
    if (socket) {
      socket.end();
    }
  };

  var writeSerial = function (data, callback) {
    socket.write(data, undefined, callback);
  };

  Espruino.Core.Serial.devices.push({
    "name": "Node Socket",
    "getPorts": getPorts,
    "open": openSerial,
    "write": writeSerial,
    "close": closeSerial,
  });
})();
