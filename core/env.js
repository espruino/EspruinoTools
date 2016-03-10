/**
 Copyright 2014 Gordon Williams (gw@pur3.co.uk)

 This Source Code is subject to the terms of the Mozilla Public
 License, v2.0. If a copy of the MPL was not distributed with this
 file, You can obtain one at http://mozilla.org/MPL/2.0/.
 
 ------------------------------------------------------------------
  Board Environment variables (process.env) - queried when board connects 
 ------------------------------------------------------------------
**/
"use strict";
(function(){
  
  var JSON_DIR = "http://www.espruino.com/json/";
  
  var environmentData = {};
  var boardData = {};
  
  function init() {
    Espruino.Core.Config.add("ENV_ON_CONNECT", {
      section : "Communications",
      name : "Request board details on connect",
      description : 'Just after the board is connected, should we query `process.env` to find out which board we\'re connected to? '+
                    'This enables the Web IDE\'s code completion, compiler features, and firmware update notice.',
      type : "boolean",
      defaultValue : true, 
    });    
    
    Espruino.addProcessor("connected", function(data, callback) {
      // Give us some time for any stored data to come in
      setTimeout(queryBoardProcess, 200, data, callback);
    });
  }
  
  function queryBoardProcess(data, callback) {    
    if (!Espruino.Config.ENV_ON_CONNECT) {
      return callback(data);
    }

    Espruino.Core.Utils.executeExpression("process.env", function(result) {
      var json = {};
      if (result!==undefined) {
        try {       
          json = JSON.parse(result);
        } catch (e) {
          console.log("JSON parse failed - " + e + " in " + JSON.stringify(result));
        }
      }
      // now process the enviroment variables
      for (var k in json) {
        boardData[k] = json[k];
        environmentData[k] = json[k];
      }
      if (environmentData.VERSION) {
        var v = environmentData.VERSION;
        var vIdx = v.indexOf("v");
        if (vIdx>=0) {
          environmentData.VERSION_MAJOR = parseInt(v.substr(0,vIdx));
          var minor = v.substr(vIdx+1);
          var dot = minor.indexOf(".");
          if (dot>=0)
            environmentData.VERSION_MINOR = parseInt(minor.substr(0,dot)) + parseInt(minor.substr(dot+1))*0.001;
          else
            environmentData.VERSION_MINOR = parseFloat(minor);
        }
      }
      
      Espruino.callProcessor("environmentVar", environmentData, function(data) { 
        environmentData = data; 
      }); 
      callback(data);
    });    
  }
  
  /** Get all data merged in from the board */
  function getData() {
    return environmentData;
  }
  
  /** Get just the board's environment data */
  function getBoardData() {
    return boardData;
  }
  
  /** Get a list of boards that we know about */
  function getBoardList(callback) {
    Espruino.Core.Utils.getJSONURL(JSON_DIR + "boards.json", function(boards){
     // now load all the individual JSON files 
      var promises = [];      
      for (var boardId in boards) {
        promises.push((function() {
          var id = boardId;
          return new Promise(function(resolve, reject) {
            Espruino.Core.Utils.getJSONURL(JSON_DIR + boards[boardId].json, function (data) {
              boards[id]["json"] = data;
              dfd.resolve();
            });
          });
        })());
      }
      
      // When all are loaded, load the callback
      Promise.all(promises).then(function(){ 
        callback(boards); 
      });      
    });
  }
  
  Espruino.Core.Env = {
    init : init,
    getData : getData,
    getBoardData : getBoardData,
    getBoardList : getBoardList,
  };
}());
