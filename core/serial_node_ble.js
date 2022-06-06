(function () {

  /*
  In order to allow a connection with the DBus daemon, you have to set up right permissions.

  Create the file `/etc/dbus-1/system.d/node-ble.conf` with the following content (customize with userid)

<!DOCTYPE busconfig PUBLIC "-//freedesktop//DTD D-BUS Bus Configuration 1.0//EN"
  "http://www.freedesktop.org/standards/dbus/1.0/busconfig.dtd">
<busconfig>
  <policy user="%userid%">
   <allow own="org.bluez"/>
    <allow send_destination="org.bluez"/>
    <allow send_interface="org.bluez.GattCharacteristic1"/>
    <allow send_interface="org.bluez.GattDescriptor1"/>
    <allow send_interface="org.freedesktop.DBus.ObjectManager"/>
    <allow send_interface="org.freedesktop.DBus.Properties"/>
  </policy>
</busconfig>

  */

  if (typeof require === 'undefined') return;

  var NORDIC_SERVICE = "6e400001-b5a3-f393-e0a9-e50e24dcca9e";
  var NORDIC_TX = "6e400002-b5a3-f393-e0a9-e50e24dcca9e";
  var NORDIC_RX = "6e400003-b5a3-f393-e0a9-e50e24dcca9e";
  var NORDIC_TX_MAX_LENGTH = 20;

  var adapter = undefined;
  var errored = false;
  
  var bluetooth;

  var btDevice;
  var btUARTService;
  var txCharacteristic;
  var rxCharacteristic;
  var txInProgress = false;
  var scanStopTimeout = undefined;

  function init() {
    Espruino.Core.Config.add("BLUETOOTH_LOW_ENERGY_DBUS", {
      section: "Communications",
      name: "Connect over Bluetooth Smart (BTLE) via 'node-ble'",
      descriptionHTML: 'Allow connection to Espruino via BLE with the Nordic UART implementation',
      type: "boolean",
      defaultValue: true
    });
  }

  async function getAdapter() {
    if (adapter)
      return adapter;
      
    try {
      var {createBluetooth} = require('node-ble');
      var BT = createBluetooth();
      bluetooth = BT.bluetooth;
      process.on('exit', () => BT.destroy());
    } catch (e) {
      console.log("Node-ble: module couldn't be loaded, no node.js Bluetooth Low Energy\n", e);
      errored = true;
    }

    adapter = await bluetooth.defaultAdapter();
    if (Espruino.Config.WEB_BLUETOOTH || Espruino.Config.BLUETOOTH_LOW_ENERGY) {
      // Everything has already initialised, so we must disable
      // web bluetooth this way instead
      console.log("Node-ble: Disable other bluetooth plugins as we have Node-ble instead");
      Espruino.Config.WEB_BLUETOOTH = false;
      Espruino.Config.BLUETOOTH_LOW_ENERGY = false;
    }

    return adapter;
  }

  async function scanDevices(adapter) {
    console.log("Scanning...");
    await adapter.startDiscovery();
    await new Promise(resolve => setTimeout(resolve, 3000));
    await adapter.stopDiscovery();

    devices = await adapter.devices();

    reportedDevices = []

    await devices.reduce((p,address) => p.then(() =>
      adapter.getDevice(address)).then((d) => {
        newDevice = { path: address, type: "bluetooth" };
        return d.helper.prop('UUIDs').then((uuids) => {
          d.getAlias().catch(() => '').then((n) => {
            newDevice['description'] = n;
            if (uuids.includes(NORDIC_SERVICE) || Espruino.Core.Utils.isRecognisedBluetoothDevice(n))
              reportedDevices.push(newDevice);
          });
        });
      }), Promise.resolve());

    return reportedDevices;
  }

  var getPorts = function (callback) {
    console.log("Getting ports");
    if (errored || !Espruino.Config.BLUETOOTH_LOW_ENERGY_DBUS) {
      console.log("Node-ble: getPorts - disabled");
      callback([], true);
      return;
    }

    getAdapter().then((adapter) =>
    scanDevices(adapter)).catch(() =>
      callback([], true)
    ).then((devices) =>
      callback(devices, false)
    );
  };

  var closeSerial = function () {
    if (btDevice) {
      btDevice.disconnect();
    }
  };

  var openSerial = function (serialPort, openCallback, receiveCallback, disconnectCallback) {
    txInProgress = false;

    console.log("BT> Connecting");

    adapter.getDevice(serialPort).then((d) => {
      btDevice = d;
      return btDevice.connect();

    }).catch(() => {
      console.error("BT> ERROR Connecting");
      btDevice = undefined;
      return openCallback();

    }).then(() => {
      btDevice.on('disconnect', function() {
        txCharacteristic = undefined;
        rxCharacteristic = undefined;
        btUARTService = undefined;
        btDevice = undefined;
        txInProgress = false;
        disconnectCallback();
      });

      return btDevice.gatt();

    }).then((g) =>
      g.getPrimaryService(NORDIC_SERVICE)

    ).then((sv) => {
      btUARTService = sv;
      return btUARTService.getCharacteristic(NORDIC_TX);

    }).then((tx) => {
      txCharacteristic = tx;
      return btUARTService.getCharacteristic(NORDIC_RX);

    }).then((rx) => {
      rxCharacteristic = rx;
      console.log("BT> Connected");

      rxCharacteristic.on('valuechanged', (data) =>
        receiveCallback(new Uint8Array(data).buffer)
      );

      return rxCharacteristic.isNotifying().then((n) => {
        if (n)
          console.error("Another process is connected to this device, problems may occur.");
      }).then(() => rxCharacteristic.startNotifications()).then(() =>
        openCallback(true)
      );
    }).catch((e) => {
      console.error("BT> ERROR getting services/characteristics");
      console.error(e,e.stack);
      closeSerial();
      return openCallback();
    });
  };

  // Throttled serial write
  var writeSerial = function (data, callback) {
    if (txCharacteristic === undefined) return;

    if (data.length>NORDIC_TX_MAX_LENGTH) {
      console.error("BT> TX length >"+NORDIC_TX_MAX_LENGTH);
      return callback();
    }
    if (txInProgress) {
      console.error("BT> already sending!");
      return callback();
    }

    console.log("BT> send "+JSON.stringify(data));
    txInProgress = true;
    txCharacteristic.writeValue(Espruino.Core.Utils.stringToBuffer(data), {type:'command'}).then(() => {
      txInProgress = false;
      return callback();
    }).catch((e) => {
      console.error("BT> SEND ERROR " + e);
        closeSerial();
    });
  };

  // ----------------------------------------------------------

  Espruino.Core.Serial.devices.push({
    "name" : "Node-ble Bluetooth LE",
    "init": init,
    "getPorts": getPorts,
    "open": openSerial,
    "write": writeSerial,
    "close": closeSerial,
    "maxWriteLength" : NORDIC_TX_MAX_LENGTH,
  });
})();
