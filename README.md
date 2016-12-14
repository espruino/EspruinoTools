Espruino Tools
==============

This repository contains a set of tools for the [Espruino JavaScript Interpreter](http://www.espruino.com).

While it is used directly by the [Espruino Web IDE](http://www.github.com/espruino/EspruinoWebIDE), there's are also simple command-line and `node.js` interfaces.


Command-line
------------

When installed as a Node module with `npm install -g espruino` you get a command-line tool called `espruino`:

```
USAGE: espruino ...options... [file_to_upload.js]

  -h,--help               : Show this message
  -j job.json             : Load options from JSON job file - see configDefaults.json for example,
  -c,--color              : Color mode,
  -v,--verbose            : Verbose
  -q,--quiet              : Quiet - apart from Espruino output
  -m,--minify             : Minify the code before sending it
  -w,--watch              : If uploading a JS file, continue to watch it for
                            changes and upload again if it does.
  -p,--port /dev/ttyX     : Specify port(s) to connect to
  -b baudRate             : Set the baud rate of the serial connection
                            No effect when using USB, default: 9600
  --no-ble                : Disable Bluetooth Low Energy (used by default if the 'bleat' module exists)
  --list                  : List all available devices and exit
  -t,--time               : Set Espruino's time when uploading code
  -o out.js               : Write the actual JS code sent to Espruino to a file
  -f firmware.bin         : Update Espruino's firmware to the given file
                              Espruino must be in bootloader mode
                              Optionally skip N first bytes of the bin file,
  -e command              : Evaluate the given expression on Espruino
                              If no file to upload is specified but you use -e,
                              Espruino will not be reset

If no file, command, or firmware update is specified, this will act
as a terminal for communicating directly with Espruino. Press Ctrl-C
twice to exit.
```

For instance:

```
# Connect to Espruno and act as a terminal app  (IF Espruino is the only serial port reported)
espruino

# Connect to Espruino on the specified port, act as a terminal
espruino -p /dev/ttyACM0

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
esp.sendFile (port, filename, callback);

/** Execute an expression on Espruino, call the callback with the result (calls 'init' automatically) */
esp.expr(port, expr, callback(result));

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
