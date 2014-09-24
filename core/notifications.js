/**
 Copyright 2014 Gordon Williams (gw@pur3.co.uk)

 This Source Code is subject to the terms of the Mozilla Public
 License, v2.0. If a copy of the MPL was not distributed with this
 file, You can obtain one at http://mozilla.org/MPL/2.0/.
 
 ------------------------------------------------------------------
  Display Notifications
 ------------------------------------------------------------------
**/
"use strict";

(function() {

  function init()
  {
  }

  Espruino.Core.Notifications = {
      init : init,
      success: function(msg, setStatus)
      {
        toastr.success(msg);
      },
      error: function(msg, setStatus)
      {
        toastr.error(msg);
      },
      warning: function(msg, setStatus)
      {
        Espruino.callProcessor("notification",{type:"warning",msg:msg},function(){});
      },
      info: function(msg, setStatus)
      {
        Espruino.callProcessor("notification",{type:"info",msg:msg},function(){});
      }
  };
  
})();
