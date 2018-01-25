/**
 Copyright 2014 Gordon Williams (gw@pur3.co.uk)

 This Source Code is subject to the terms of the Mozilla Public
 License, v2.0. If a copy of the MPL was not distributed with this
 file, You can obtain one at http://mozilla.org/MPL/2.0/.
 
 ------------------------------------------------------------------
  Try and get any URLS that are from GitHub
 ------------------------------------------------------------------
**/
"use strict";
(function(){
  
  function init() {
    Espruino.addProcessor("getURL", getGitHub);      
  }
  
  function getGitHub(data, callback) {
    var match = data.url.match(/^https?:\/\/github.com\/([^\/]+)\/([^\/]+)\/blob\/([^\/]+)\/(.*)$/);
    if (match) {
      var git = {
          owner : match[1],
          repo : match[2],
          branch : match[3],
          path : match[4]
          };
      
      var url = "https://raw.githubusercontent.com/"+git.owner+"/"+git.repo+"/"+git.branch+"/"+git.path;
      console.log("Found GitHub", JSON.stringify(git));
      callback({url: url});
    } else
      callback(data); // no match - continue as normal
  }

  Espruino.Plugins.GetGitHub = {
    init : init,
  };
}());
