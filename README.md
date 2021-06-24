Espruino Tools
==============

This repository contains a set of tools for the [Espruino JavaScript Interpreter](http://www.espruino.com).

While it is used directly by the [Espruino Web IDE](http://www.github.com/espruino/EspruinoWebIDE), there are also simple command-line and `node.js` interfaces.


Command-line
------------

When installed as a Node module with `npm install -g espruino` you get a command-line tool called `espruino`:

```
Espruino Command-line Tool 0.1.20
-----------------------------------

USAGE: espruino ...options... [file_to_upload.js]

  -h,--help                : Show this message
  -j [job.json]            : Load options from JSON job file - see configDefaults.json
                               Calling without a job filename creates a new job file
                               named after the uploaded file
  -v,--verbose             : Verbose
  -q,--quiet               : Quiet - apart from Espruino output
  -m,--minify              : Minify the code before sending it
  -t,--time                : Set Espruino's time when uploading code
  -w,--watch               : If uploading a JS file, continue to watch it for
                               changes and upload again if it does.
  -e command               : Evaluate the given expression on Espruino
                               If no file to upload is specified but you use -e,
                               Espruino will not be reset
  --sleep 10               : Sleep for the given number of seconds after uploading code
  -n                       : Do not connect to Espruino to upload code
  --board BRDNAME/BRD.json : Rather than checking on connect, use the given board name or file
  --ide [8080]             : Serve up the Espruino Web IDE on the given port. If not specified, 8080 is the default.

  -p,--port /dev/ttyX      : Connect to a serial port
  -p,--port aa:bb:cc:dd:ee : Connect to a Bluetooth device by addresses
  -p,--port tcp://192.168.1.50 : Connect to a network device (port 23 default)
  -d deviceName            : Connect to the first device with a name containing deviceName
  --download fileName      : Download a file with the name matching fileName to the current directory
  -b baudRate              : Set the baud rate of the serial connection
                               No effect when using USB, default: 9600
  --no-ble                 : Disables Bluetooth Low Energy (using the 'noble' module)
  --list                   : List all available devices and exit

  --listconfigs            : Show all available config options and exit
  --config key=value       : Set internal Espruino config option

  -o out.js                : Write the actual JS code sent to Espruino to a file
  --ohex out.hex           : Write the JS code to a hex file as if sent by E.setBootCode
  --storage fn:data.bin    : Load 'data.bin' from disk and write it to Storage as 'fn'
  --storage .boot0:-       : Store program code in the given Storage file (not .bootcde)

  -f firmware.bin[:N]      : Update Espruino's firmware to the given file
                               Must be a USB Espruino in bootloader mode
                               (bluetooth is not currently supported).
                               Optionally skip N first bytes of the bin file.

If no file, command, or firmware update is specified, this will act
as a terminal for communicating directly with Espruino. Press Ctrl-C
twice to exit.

Please report bugs via https://github.com/espruino/EspruinoTools/issues

```

For instance:

```
# Connect to Espruino and act as a terminal app  (IF Espruino is the only serial port reported)
espruino

# Connect to Espruino on the specified port, act as a terminal
espruino -p /dev/ttyACM0

# Connect to the first device found with 'Puck' in the name (eg. a Puck.js via Bluetooth)
espruino -d puck

# Write a program to Espruino (IF Espruino is the only serial port reported)
espruino myprogram.js

# Otherwise you'll want to specify the exact port first
espruino -p /dev/ttyACM0 myprogram.js

# Write a program to Espruino and drop into a terminal, but then monitor
# myprogram.js for changes and upload it again
espruino --watch myprogram.js

# Load a file into two Espruino boards
espruino -p /dev/ttyACM1 /dev/ttyACM2 mycode.js

# Load a file into Espruino and save
espruino -p /dev/ttyACM0 mycode.js -e "save()"

# Write mycode.js to the first Bangle.js device found as a Storage file named app.js
espruino -d Bangle.js mycode.js --storage app.js:-

# As above, but also write app_image.bin to the device as a Storage file named app.img
espruino -d Bangle.js mycode.js --storage app.js:- --storage app.img:app_image.bin

# Connect to Bluetooth device address c6:a8:1a:1f:87:16 and download setting.json from Storage to a local file
bin/espruino-cli.js -p c6:a8:1a:1f:87:16 --download setting.json

# Execute a single command on the default serial device
espruino -e "digitalWrite(LED1,1);"
```

Bluetooth
----------
If the NPM module `noble` is installed, it'll be used to scan for Bluetooth LE UART devices like [Puck.js](http://puck-js.com). It's an optional dependency, so will be installed if possible - but if not you just won't get BLE support.

If it is installed and you don't want it, you can use `./espruino --no-ble` to disable it for the one command, or can remove the module with `npm remove noble`.

On linux, you'll need to run as superuser to access Bluetooth Low Energy. To avoid this you need to give node.js the relevant privileges with:

```
sudo setcap cap_net_raw+eip $(eval readlink -f `which node`)
```

Not Connecting
--------------

Sometimes, you might want to run your JS file(s) through the Espruino Tools
to create an output file that contains everything required, including modules.
This file can then be sent directly to Espruino at some later time -
sometimes just `cat file.js > /dev/ttyACM0` is enough.

To do this, you don't need to connect, you just need to be able to specify the
board type, which corresponds to a JSON file in http://www.espruino.com/json/

```
# Get a minified, complete JS file
espruino --board PUCKJS --minify mycode.js -o output.js
```

You can also request an Intel Hex style output. This only works on some
devices, but allows you to write directly into Espruino's memory space
with a flashing tool.

This is as if `E.setBootCode(your_code)` was called in the interpreter,
except it doesn't have any code size limitations. It means that any
functions that are defined in your program will be executed directly
from Flash, without taking up any RAM.

```
# Get a hex file that can be flashed directly to the board (containing just the code)
espruino --board PUCKJS mycode.js --ohex output.hex

# Get a hex file, include 'myModule.js' as a file inside Storage
espruino --board PUCKJS mycode.js --storage myModule:myModule.js --ohex output.hex

# Create a complete hex file (including Espruino)
espruino --board PUCKJS mycode.js --ohex output.hex
mergehex -m espruino_2vXX_puckjs.hex output.hex -o out.hex
```

**Note:** If you're creating a complete hex file including the firmware,
we do not distribute complete firmware hex files for our devices. You can
either build your own from source or get in touch to request one.


Configuration
-------------

In Espruino's Web IDE there are a lot of different config options. These
end up toggling Config settings in Espruino. You can find what these are
by going into the Web IDE, changing the option in Settings, then going
to the `Console` window and scrolling to the bottom. You should see
something like `Config.RESET_BEFORE_SEND => true`

You can then add the command-line option `--config RESET_BEFORE_SEND=true`
to recreate this.

You can also use `--listconfigs` to give you a nice list of configs with
their descriptions.

NPM Module
----------

This is the NPM module [`espruino`](https://www.npmjs.com/package/espruino).

Once installed with `npm install -g espruino` it contains the following functions:

```
var esp = require("espruino");

/** Initialise EspruinoTools and call the callback.
 When the callback is called, the global variable 'Espruino'
 will then contain everything that's needed to use EspruinoTools */
esp.init(callback);

/** Send a file to an Espruino on the given port, call the callback when done (calls 'init' automatically) */
esp.sendFile(port, filename, callback);

/** Send code to an Espruino on the given port, call the callback when done (calls 'init' automatically) */
esp.sendCode(port, "LED.set()\n", callback);

/** Execute an expression on Espruino, call the callback with the result (calls 'init' automatically) */
esp.expr(port, expr, callback(result));

/** Execute a statement on Espruino, call the callback with anything that gets printed (calls 'init' automatically) */
esp.statement(port, expr, callback(result));

/** Flash the given firmware file to an Espruino board (calls 'init' automatically) */
esp.flash(port, filename, callback);
```

For example, to get the current temperature of the board you can do:

```
require('espruino').expr('/dev/ttyACM0', 'E.getTemperature()', function(temp) {
        console.log('Current temperature is '+temp);
});
```

**Note:** this module is currently prints a lot of debug
information to `console.log` when working.

If you want to set specific options, for example Baud rate, initialise everything explicitly with `init`, set the options, and then call the function you need:

```
var esp = require("espruino");
esp.init(function() {
  Espruino.Config.BAUD_RATE = "115200";
  esp.sendFile(port, filename, function() {
    console.log('Done!');
  })
});
```

Job File
--------

A job file simplifies specifying the command-line and provides a future record of the run setup. Specifying the -j option without a job file name will generate a job file automatically using the given JS code file as the base name and any commandline arguments specified.

For example,
  espruino -j -t -w test.js; // will create test.json

The following table provides a guide for setting configuration fields, but consult the code for certainty. Module/pluggin values generally override other keys. It is not necessary to include any fields except the ones you want.

| Commandline Argument | JSON Key *1,2*         | Module/Pluggin *2,3*                               |        
| -------------------- | --------------         | --------------------                               |
| file_to_upload.js    | file ("")              |                                                    |
| -b baudrate          | baudRate (0)           | BAUD_RATE (9600)                                   |
| -c                   | color (false)          |                                                    |
| -e command           | expr ("")              |                                                    |
| -f firmware.bin      | updateFirmware ("")    |                                                    |
|                      | firmwareFlashOffset(0) |                                                    |
| --list               | showDevices (false)    |                                                    |
| -m,-minify           | minify (false)         | MINIFICATION_LEVEL ("")                            |
|                      |                        | MINIFICATION_Mangle (true) *4*                     |
| -no-ble              | no-ble (false)         | BLUETOOTH_LOW_ENERGY (true)                        |
| -o out.js            | outputJS ("")          |                                                    |
| -p,--port /dev/ttyX  | ports ([""])           |                                                    |
| -q,--quiet           | quiet (false)          |                                                    |
| -t,--time            | setTime (false)        | SET_TIME_ON_WRITE (false)                          |
| -v,--verbose         | verbose (false)        |                                                    |
| -w,--watch           | watchFile (false)      |                                                    |
|                      |                        | BOARD_JSON_URL ("http://www.espruino.com/json")    |
|                      |                        | COMPILATION (true)                                 |
|                      |                        | COMPILATION_URL ("http://www.espruino.com:32766")  |
|                      |                        | ENV_ON_CONNECT (true)                              |
|                      |                        | MODULE_AS_FUNCTION (false)                         |
|                      |                        | MODULE_EXTENSIONS (".min.js|.js")                  |
|                      |                        | MODULE_MINIFICATION_LEVEL ("")                     |
|                      |                        | MODULE_URL ("http://www.espruino.com/modules") *5* |
|                      |                        | NPM_MODULES (false)                                |
|                      |                        | RESET_BEFORE_SEND (true)                           |
|                      |                        | SAVE_ON_SEND (0)                                   |
|                      |                        | SERIAL_AUDIO (0)                                   |
|                      |                        | SERIAL_TCPIP ("")                                  |
|                      |                        | SERIAL_THROTTLE_SEND (false)                       |
|                      |                        | STORE_LINE_NUMBERS (true)                          |
|                      |                        | UI_MODE ("Normal")                                 |
|                      |                        | WEB_BLUETOOTH (true)                               |

Notes:
  1. JSON keys equate to internal *args* variable keys.
  2. Default values shown in parentheses or see configDefaults.json file under node_modules/espruino folder. Check code directly for issues.
  3. Recommended for advanced users only. Module and plugin keys equate to internal *Espruino.Config* variable keys stored in job file as subkeys under *espruino* key. Consult code for possible values.
  4. Minification parameters only work if level set, e.g. MINIFICATION_LEVEL: "ESPRIMA".
  5. MODULE_URL accepts a pipe delimited (|) list of URLS, including local servers and absolute or relative paths based on the code file. For example, "../../modules|http://localhost:8080/modules|http://www.espruino.com/modules" will first look in the module folder located two folders up from the code, then query the localhost server, and then look in the Espruino repository.

Internals
---------

This isn't well documented right now, but basically:

* You have a bunch of source files that are automatically loaded by `index.js`
* These add things to `Espruino.Core` or `Espruino.Plugins`
* They also register themselves as `processors` with `Espruino.addProcessor`. For instance you might register for `"transformForEspruino"` in which case you can do something to the JS code before it's finally sent to Espruino.
* You then call into `Espruino.Core.X` or `Espruino.Plugins.Y` to do what you want

It's not ideal for node.js, but was designed to run in the Web browser for the [Espruino Web IDE](http://www.github.com/espruino/EspruinoWebIDE)


Contributing
------------

Contributions would he hugely appreciated - sadly I'm stretched a bit thin with Espruino, Espruino's modules, the Web IDE and forum, so this isn't getting the love it deserves.

Please be aware that the Espruino Web IDE (and even [a truly online version of the Web IDE](http://espruino.github.io/EspruinoWebIDE/) depend heavily this code - so try not to do anything that will break them).

### Code Style

 * Please stick to a [K&R style](http://en.wikipedia.org/wiki/1_true_brace_style#K.26R_style) with no tabs and 2 spaces per indent
 * Filenames should start with a lowerCase letter, and different words should be capitalised, not split with underscores

### Code Outline

 * Core functionality goes in `core`, Plugins go in `plugins`. See `plugins/_examplePlugin.js` for an example layout
 * Serial port handlers are a special case - they just add themselves to the `Espruino.Core.Serial.devices` array when loaded.
 * Plugins/core need to implement in init function, which is called when the document (and settings) have loaded.
 * Plugins can respond to specific events using `Espruino.addProcessor`. For instance you can use `Espruino.addProcessor("transformForEspruino", function (data,callback) { .. })` and can modify code before it is sent to Espruino. Events types are documented at the top of `espruino.js`
 * Config is stored in `Espruino.Config.FOO` and is changed with `Espruino.Config.set("FOO", value)`. `Espruino.Core.Config.add` can be used to add an option to the Settings menu.


RELATED
-------

There are other tools available to program Espruino:

* (Recommended) The [Espruino Web IDE](http://www.github.com/espruino/EspruinoWebIDE) (Google Chrome)
* [Online version of the Web IDE](http://espruino.github.io/EspruinoWebIDE/) (any browser - limited to serial over audio or Web Bluetooth)
* [espruino-cli](https://www.npmjs.org/package/espruino-cli) (node.js)
* [node-espruino](https://www.npmjs.com/package/node-espruino) (node.js)
* [grunt-espruino](https://www.npmjs.com/package/grunt-espruino) (node.js)
* [espruino](https://github.com/olliephillips/espruingo) (Go)

*Note:* while other tools exist, this EspruinoTools module and the Web IDE which uses it are maintained alongside the Espruino firmware, and tend to have support for various features and edge cases that other tools might not.
