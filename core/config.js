/**
 Copyright 2014 Gordon Williams (gw@pur3.co.uk)

 This Source Code is subject to the terms of the Mozilla Public
 License, v2.0. If a copy of the MPL was not distributed with this
 file, You can obtain one at http://mozilla.org/MPL/2.0/.

 ------------------------------------------------------------------
  Central place to store and retrieve Options

  To use this, on your plugin's `init` function, do something like the
  following:

  Espruino.Core.Config.add("MAX_FOOBARS", {
    section : "Communications",           // Heading this will come under in the config screen
    name : "Foobars",                     // Nice name
    description : "How many foobars?",    // More detail about this
    type : "int"/"boolean"/"string"/{ value1:niceName, value2:niceName },
    defaultValue : 20,
    onChange : function(newValue) { ... }
  });

    * onChange will be called whenever the value changes from the default
      (including when it is loaded)

  Then use:

  Espruino.Config.MAX_FOOBARS in your code
 ------------------------------------------------------------------
**/
"use strict";
(function() {

  /** See addSection and getSections */
  var builtinSections = {};

  function _get(callback) {
    if (typeof chrome !== 'undefined' && chrome.storage) {
      chrome.storage.sync.get( "CONFIGS", function (data) {
        var value = data["CONFIGS"];
        logger.debug("GET chrome.storage.sync = "+JSON.stringify(value));
        callback(value);
      });
    } else if (typeof window !== 'undefined' && window.localStorage) {
      var data = {};
      var value = window.localStorage.getItem("CONFIG");
      logger.debug("GET window.localStorage = "+JSON.stringify(value));
      try {
        data = JSON.parse(value);
      } catch (e) {
        logger.error("Invalid config data");
      }
      callback(data);
    } else if (typeof document != "undefined") {
      var data = {};
      var cookie = document.cookie;
      if (cookie!==undefined && cookie.indexOf("CONFIG=")>=0) {
        cookie = cookie.substring(cookie.indexOf("CONFIG=")+7);
        cookie = cookie.substring(0,cookie.indexOf(";"));
        try {
          var json = atob(cookie);
          data = JSON.parse(json);
        } catch (e) {
          logger.error("Got ", e, " while reading info");
        }
      }
      callback(data);
    } else {
      callback({});
    }
  }

  function _set(data) {
    if (typeof chrome !== 'undefined' && chrome.storage) {
      logger.debug("SET chrome.storage.sync = "+JSON.stringify(data,null,2));
      chrome.storage.sync.set({ CONFIGS : data });
    } else if (typeof window !== 'undefined' && window.localStorage) {
      logger.debug("SET window.localStorage = "+JSON.stringify(data,null,2));
      window.localStorage.setItem("CONFIG",JSON.stringify(data));
    } else if (typeof document != "undefined") {
      document.cookie = "CONFIG="+btoa(JSON.stringify(data));
    }
  }

  function loadConfiguration(callback) {
    _get(function (value) {
      for (var key in value) {
        if (key=="set") continue;
        Espruino.Config[key] = value[key];
        if (Espruino.Core.Config.data[key] !== undefined &&
          Espruino.Core.Config.data[key].onChange !== undefined)
          Espruino.Core.Config.data[key].onChange(value[key]);
      }
      if (callback!==undefined)
        callback();
    });
  }

  function init() {
    addSection("General", { sortOrder:100, description: "General Web IDE Settings" });
    addSection("Communications", { sortOrder:200, description: "Settings for communicating with the Espruino Board" });
    addSection("Board", { sortOrder:300, description: "Settings for the Espruino Board itself" });
  }

  function add(name, options) {
    Espruino.Core.Config.data[name] = options;
    if (Espruino.Config[name] === undefined)
      Espruino.Config[name] = options.defaultValue;
  }

  /** Add a section (or information on the page).
   * options = {
   *   sortOrder : int, // a number used for sorting
   *   description : "",
   *   getHTML : function(callback(html)) // optional
   * };
   */
  function addSection(name, options) {
    options.name = name;
    builtinSections[name] = options;
  }

  /** Get an object containing the information on a section used in configs */
  function getSection(name) {
    if (builtinSections[name]!==undefined)
      return builtinSections[name];
    // not found - but we warned about this in getSections
    return {
      name : name
    };
  }

  /** Get an object containing information on all 'sections' used in all the configs */
  function getSections() {
    var sections = [];
    // add sections we know about
    for (var name in builtinSections)
      sections.push(builtinSections[name]);
    // add other sections
    for (var i in Espruino.Core.Config.data) {
      var c = Espruino.Core.Config.data[i];

      var found = false;
      for (var s in sections)
        if (sections[s].name == c.section)
          found = true;

      if (!found) {
        logger.warn("Section named "+c.section+" was not added with Config.addSection");
        sections[c.section] = {
            name : c.section,
            sortOrder : 0
        };
      }
    }
    // Now sort by sortOrder
    sections.sort(function (a,b) { return a.sortOrder - b.sortOrder; });

    return sections;
  }

  Espruino.Config = {};
  Espruino.Config.set = function (key, value) {
    if (Espruino.Config[key] != value) {
      Espruino.Config[key] = value;
      // Do the callback
      if (Espruino.Core.Config.data[key] !== undefined &&
          Espruino.Core.Config.data[key].onChange !== undefined)
        Espruino.Core.Config.data[key].onChange(value);
      // Save to synchronized storage...
      var data = {};
      for (var key in Espruino.Config)
        if (key != "set")
          data[key] = Espruino.Config[key];
      _set(data);
    }
  };

  function clearAll() { // clear all settings
    _set({});
    for (var name in Espruino.Core.Config.data) {
      var options = Espruino.Core.Config.data[name];
      Espruino.Config[name] = options.defaultValue;
    }
  }

  Espruino.Core.Config = {
      loadConfiguration : loadConfiguration, // special - called before init

      init : init,
      add : add,
      data : {},


      addSection : addSection,
      getSection : getSection,
      getSections : getSections,

      clearAll : clearAll, // clear all settings
  };

})();
