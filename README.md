Espruino Tools
=============

This repository contains a set of tools for the [Espruino JavaScript Interpreter](http://www.espruino.com). Mainly, it is used by the [Espruino Web IDE](http://www.github.com/espruino/EspruinoWebIDE) although hopefully it is portable enough to be used by other tools such as command-line interfaces.

Command-line
------------

When installed as a Node module with `npm install -g espruino` you get a command-line tool called `espruinotool`:

```
USAGE: espruinotool ...options... [file_to_upload.js]

  -h,--help               : Show this message
  -v,--verbose            : Verbose
  -q,--quiet              : Quiet - apart from Espruino output
  -m,--minify             : Minify the code before sending it
  -p,--port /dev/ttyX     : Specify port(s) to connect to
  -f firmware.bin         : Update Espruino's firmware to the given file
                              Espruino must be in bootloader mode
  -e command              : Evaluate the given expression on Espruino
                              If no file to upload is specified but you use -e,
                              Espruino will not be reset
```

For instance:

```
# Write a program to Espruino (IF Espruino is the only serial port reported)
espruinotool myprogram.js

# Otherwise you'll want to specify the exact port first
espruinotool -p /dev/ttyACM0 myprogram.js
```


NPM Module
----------

This is the NPM module [`espruino`](https://www.npmjs.com/package/espruino)

It contains the following functions:

```
var esp = require("espruino");

/** Initialise EspruinoTools and call the callback.
 When the callback is called, the global variable 'Espruino'
 will then contain everything that's needed to use EspruinoTools */
esp.init(callback);

/** Send a file to an Espruino on the given port, call the callback when done */
esp.sendFile (port, filename, callback);

/** Execute an expression on Espruino, call the callback with the result */
esp.expr(port, expr, callback(result));

/** Flash the given firmware file to an Espruino board. */
esp.flash(port, filename, callback);
```


Internals
---------

This isn't well documented right now, but basically:

* You have a bunch of source files that are automatically run
* These add things to `Espruino.Core` or `Espruino.Plugins`
* You then call into those to do what you want

It's not ideal for node.js, but was designed to run in the Web browser for the [Espruino Web IDE](http://www.github.com/espruino/EspruinoWebIDE)


To Do
-----

While [EspruinoTools](http://www.github.com/espruino/EspruinoTools) has been in use in the Web IDE for a while, the command-line tool still needs a lot of work.



Contributing
------------

Contributions would he hugely appreciated - sadly I'm stretched a bit thin with Espruino, Espruino's modules, the Web IDE and forum, so this isn't getting the love it deserves.

Please be aware that the Espruino Web IDE (and even [a truly online version of the Web IDE](http://espruino.github.io/EspruinoWebIDE/) depend heavily this code - so try not to do anything that will break them).

### Code Style

 * Please stick to a [K&R style](http://en.wikipedia.org/wiki/1_true_brace_style#K.26R_style) with no tabs and 2 spaces per indent
 * Filenames should start with a lowerCase letter, and different words should be capitalised, not split with underscores
 
### Code Outline

 * Core functionality goes in `core`, Plugins go in `plugins`. See `plugins/_examplePlugin.js` for an example layout
 * Plugins/core need to implement in init function, which is called when the document (and settings) have loaded.
 * Plugins can respond to specific events using `Espruino.addProcessor`. For instance you can use `Espruino.addProcessor("transformForEspruino", function (data,callback) { .. })` and can modify code before it is sent to Espruino. Events types are documented at the top of `espruino.js`
 * Config is stored in `Espruino.Config.FOO` and is changed with `Espruino.Config.set("FOO", value)`. `Espruino.Core.Config.add` can be used to add an option to the Settings menu.

