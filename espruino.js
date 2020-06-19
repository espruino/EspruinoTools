/**
 Copyright 2014 Gordon Williams (gw@pur3.co.uk)

 This Source Code is subject to the terms of the Mozilla Public
 License, v2.0. If a copy of the MPL was not distributed with this
 file, You can obtain one at http://mozilla.org/MPL/2.0/.

 ------------------------------------------------------------------
  Initialisation code
 ------------------------------------------------------------------
**/
"use strict";

var Espruino;

(function() {

  /** List of processors. These are functions that are called one
   * after the other with the data received from the last one.
   *
   * Common processors are:
   *
   *   jsCodeChanged        - called when the code in the editor changes with {code}
   *   sending              - sending code to Espruino (no data)
   *   transformForEspruino - transform code ready to be sent to Espruino
   *   transformModuleForEspruino({code,name})
   *           - transform module code before it's sent to Espruino with Modules.addCached (we only do this if we don't think it's been minified before)
   *   connected            - connected to Espruino (no data)
   *   disconnected         - disconnected from Espruino (no data)
   *   environmentVar       - Board's process.env loaded (object to be saved into Espruino.Env.environmentData)
   *   boardJSONLoaded      - Board's JSON was loaded into environmentVar
   *   getModule            - Called with data={moduleName:"foo", moduleCode:undefined} - moduleCode should be filled in if the module can be found
   *   getURL               - Called with data={url:"http://....", data:undefined) - data should be filled in if the URL is handled (See Espruino.Core.Utils.getURL to use this)
   *   terminalClear        - terminal has been cleared
   *   terminalPrompt       - we've received a '>' character (eg, `>` or `debug>`). The argument is the current line's contents.
   *   terminalNewLine      - When we get a new line on the terminal, this gets called with the last line's contents
   *   debugMode            - called with true or false when debug mode is entered or left
   *   editorHover          - called with { node : htmlNode, showTooltip : function(htmlNode) } when something is hovered over
   *   notification         - called with { mdg, type:"success","error"/"warning"/"info" }
   **/
  var processors = {};

  function init() {

    Espruino.Core.Config.loadConfiguration(function() {
      // Initialise all modules
      function initModule(modName, mod) {
        console.log("Initialising "+modName);
        if (mod.init !== undefined)
          mod.init();
      }

      var module;
      for (module in Espruino.Core) initModule(module, Espruino.Core[module]);
      for (module in Espruino.Plugins) initModule(module, Espruino.Plugins[module]);

      callProcessor("initialised", undefined, function() {
        // We need the delay because of background.js's url_handler...
        setTimeout(function() {
          Espruino.initialised = true;
        }, 1000);
      });
    });
  }

  // Automatically start up when all is loaded
  if (typeof document!=="undefined") 
    document.addEventListener("DOMContentLoaded", init);

  /** Add a processor function of type function(data,callback) */
  function addProcessor(eventType, processor) {
    if (processors[eventType]===undefined)
      processors[eventType] = [];
    processors[eventType].push(processor);
  }

  /** Call a processor function */
  function callProcessor(eventType, data, callback) {
    var p = processors[eventType];
    // no processors
    if (p===undefined || p.length==0) {
      if (callback!==undefined) callback(data);
      return;
    }
    // now go through all processors
    var n = 0;
    var cbCalled = false;
    var cb = function(inData) {
      if (cbCalled) throw new Error("Internal error in "+eventType+" processor. Callback is called TWICE.");
      cbCalled = true;
      if (n < p.length) {
        cbCalled = false;
        if ( inData !== undefined && typeof inData === "string" ) {
          inData = "(function() {\n" + inData + "\n})();";
        }
        p[n++](inData, cb);
      } else {
        if (callback!==undefined) callback(inData);
      }
    };
    cb(data);
  }

  // -----------------------------------
  Espruino = {
    Core : { },
    Plugins : { },
    addProcessor : addProcessor,
    callProcessor : callProcessor,
    initialised : false,
    init : init, // just in case we need to initialise this by hand
  };

  return Espruino;
})();
