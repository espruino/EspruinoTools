/**
 Copyright 2014 Gordon Williams (gw@pur3.co.uk)

 This Source Code is subject to the terms of the Mozilla Public
 License, v2.0. If a copy of the MPL was not distributed with this
 file, You can obtain one at http://mozilla.org/MPL/2.0/.

 ------------------------------------------------------------------
  VT100 terminal window
 ------------------------------------------------------------------
**/
"use strict";

(function(){
  if(typeof process !== "undefined" &&
     !process.versions.nw &&
     !process.versions.electron)
    return; // don't load this in std NodeJS

  var onInputData = function(d){}; // the handler for character data from user

  var displayTimeout = null;
  var displayData = [];

  // Text to be displayed in the terminal
  var termText = [ "" ];
  // Map of terminal line number to text to display before it
  var termExtraText = {};
  // List of (jquerified) DOM elements for each line
  var elements = [];

  var termCursorX = 0;
  var termCursorY = 0;
  var termControlChars = [];

  // maximum lines on the terminal
  var MAX_LINES = 2048;

  function init()
  {
    // Add buttons
    if (Espruino.Core.App) Espruino.Core.App.addIcon({
      id: "clearScreen",
      icon: "clear",
      title : "Clear Screen",
      order: -100,
      area: {
        name: "terminal",
        position: "top"
      },
      click: function(){
        clearTerminal();
        focus();
      }
    });

    // Add stuff we need
    $('<div id="terminal" class="terminal"></div>').appendTo(".editor--terminal .editor__canvas");
    $('<textarea id="terminalfocus" class="terminal__focus" rows="1" cols="1"></textarea>').appendTo(document.body);

    var terminal = document.getElementById("terminal");
    var terminalfocus = document.getElementById("terminalfocus");

    var html;
    if (Espruino.Core.Terminal.OVERRIDE_CONTENTS) {
      html = Espruino.Core.Terminal.OVERRIDE_CONTENTS;
    } else {
      html = `
    <div style="max-width:400px;margin:auto;">
      <p><a href="http://www.espruino.com/Web+IDE" target="_blank"><img src="img/ide_logo.png" width="299" height="96" alt="Espruino IDE"/></a></p>
      <p id="versioninfo" style="text-align:right"></p>
      <p style="text-align:center;font-weight:bold">A Code Editor and Terminal for <a href="http://www.espruino.com" target="_blank">Espruino JavaScript Microcontrollers</a></p>
      <p>Try the <a class="tour_link" href="#">guided tour</a> and <a href="http://www.espruino.com/Quick+Start" target="_blank">getting started</a> guide for more information, tutorials and example projects.</p>
      <div id="terminalnews"></div>
      <p>Espruino is <a href="https://github.com/espruino" target="_blank">Open Source</a>.
    Please support us by <a href="http://www.espruino.com/Donate" target="_blank">donating</a> or
      <a href="http://www.espruino.com/Order" target="_blank">buying an official board</a>.</p>
      <p style="text-align:right">
        <a href="http://twitter.com/Espruino" target="_blank"><img src="img/icon_twitter.png" width="16" height="16" alt="Follow on Twitter"/></a>
        <a href="http://youtube.com/subscription_center?add_user=espruino" target="_blank"><img src="img/icon_youtube.png" width="44" height="16" alt="Subscribe on YouTube"/></a>
        <a href="https://www.patreon.com/espruino" target="_blank"><img src="img/icon_patreon.png" width="45" height="16" alt="Support on Patreon"/></a>
      </p>
    </div>`;
      Espruino.Core.Utils.getVersionInfo(function(v) {
        $("#versioninfo").html(v);

        var r = 0|(Math.random()*1000000);
        $.get("https://www.espruino.com/ide/news.html?v="+encodeURIComponent(v.replace(/[ ,]/g,"")+"&r="+r), function (data){
          $("#terminalnews").html(data);
        });
      });
    }
    terminal.innerHTML = html;

    $(".tour_link").click(function(e) {
      e.preventDefault();
      $("#icon-tour").click();
    });

    var mouseDownTime = Date.now();
    var mouseUpTime = Date.now();
    window.addEventListener("mousedown", function() {
      mouseDownTime = Date.now();
    });
    terminal.addEventListener("mouseup" , function(e) {
      var selection = window.getSelection();
      var shortClick = Date.now() < mouseDownTime+200;
      var doubleClick = Date.now() < mouseUpTime+600;
      mouseUpTime = Date.now();
      /* Maybe we basically just clicked (<200ms)
       in which case we don't want to copy but just
       move the cursor. DON'T move cursor
       for double-clicks */
      if (shortClick && !doubleClick) {
        // Move cursor, if we can...
        if (selection &&
            selection.baseNode &&
            selection.baseNode.parentNode &&
            selection.baseNode.parentNode.className=="termLine") {
          var cx = selection.baseOffset;
          var cy = selection.baseNode.parentNode.attributes.linenumber.value;
          var prev = selection.baseNode.previousSibling;
          while (prev) {
            cx += prev.textContent.length;
            prev = prev.previousSibling;
          }
          //console.log("Click to ",cx,cy, termCursorX,termCursorY);
          var s = "";
          var tx = termCursorX;
          var ty = termCursorY;
          while (cx<tx) { tx--; s+=String.fromCharCode(27,91,68); } // left
          while (cy>ty && termText[ty+1] && ":>".indexOf(termText[ty+1][0])>=0) {
            ty++; s+=String.fromCharCode(27,91,66);
          }
          while (cy<ty && termText[ty-1] && ":>".indexOf(termText[ty-1][0])>=0) {
            ty--; s+=String.fromCharCode(27,91,65);
          }
          if (!termText[ty]) cx=0;
          else if (termText[ty].length<cx)
            cx = termText[ty].length;
          while (cx>tx) { tx++; s+=String.fromCharCode(27,91,67); } // right
          if (s.length) {
            if (termCursorY==termText.length-1 &&
                termCursorX==termText[termCursorY].length) {
              if (termCursorX<=1) {
                /* if we're right at the end, but there are no characters so
                we can't step back - don't try and move because we can't */
                s="";
              } else {
                /* if we're at the end of the last line, we need to step left
                then move, then right - or we could just end up going back in
                the command history */
                s = String.fromCharCode(27,91,68) + s + String.fromCharCode(27,91,67);
              }
            }
            if (s.length)
              onInputData(s);
          }
        }
        terminalfocus.focus();
        window.scrollTo(0,0); // as terminalfocus is offscreen, just in case force us back onscreen
        return;
      }

      /* this rather convoluted code checks to see if the selection
       * is actually part of the terminal. It may be that the user
       * clicked on the editor pane, dragged, and released over the
       * terminal in which case we DON'T want to copy. */
      if (selection.rangeCount > 0) {
        var node = selection.getRangeAt(0).startContainer;
        while (node && node!=terminal)
          node = node.parentNode;

        if (node==terminal) {
          // selection WAS part of terminal
          var selectedText = selection.toString();
          if (selectedText.trim().length > 0) {
            //console.log(selectedText);
            //console.log(selectedText.split("").map(function(c) { return c.charCodeAt(0); }));
            selectedText = selectedText.replace(/\xA0/g," "); // Convert nbsp chars to spaces
            //console.log(selectedText.split("").map(function(c) { return c.charCodeAt(0); }));

            /* Because Espruino prefixes multi-line code with ':' it makes
             it a nightmare to copy/paste. This hack gets around it. */
            var allColon = true, hasNewline = false;
            var trimmedSelectedText = selectedText.trim();
            for (var i=0;i<trimmedSelectedText.length-1;i++) {
              if (trimmedSelectedText[i]=="\n")
                hasNewline = true;
              if (trimmedSelectedText[i]=="\n" && trimmedSelectedText[i+1]!=":")
                allColon = false;
            }
            if (allColon && hasNewline) {
              selectedText = selectedText.replace(/\n:/g,"\n");
              if (selectedText[0]==">" ||
                  selectedText[1]==":")
                selectedText = selectedText.substr(1);
            }

            terminalfocus.value = selectedText;
            terminalfocus.select();
            document.execCommand('copy');
            terminalfocus.value = '';
            lastValue = '';
          }
        }
      }
      terminalfocus.focus();
    });
    terminalfocus.focus();
    terminalfocus.addEventListener("focus", function() {
      terminal.classList.add('focus');
    });
    terminalfocus.addEventListener("blur", function() {
      terminal.classList.remove('focus');
    });
    /* Super hack for Android. We can't just look at keypresses since
    it wants to do autocomplete. What we do is keep the current word
    (at least until someone presses a special char) in an input box
    and then try and send the characters needed to keep text on
    Espruino up to date with the text box. */
    var lastValue = terminalfocus.value;
    function changeListener() {
      var thisValue = terminalfocus.value;
      var commonChars = 0;
      while (commonChars<thisValue.length &&
             commonChars<lastValue.length &&
             thisValue[commonChars] == lastValue[commonChars])
        commonChars++;
      var text = "";
      for (var i=commonChars;i<lastValue.length;i++)
        text+="\x08"; // backspace
      text+=thisValue.substr(commonChars);
      lastValue = terminalfocus.value;
      if (text.length)
        onInputData(Espruino.Core.Utils.fixBrokenCode(text));
    }
    terminalfocus.addEventListener("input", changeListener);
    terminalfocus.addEventListener("keydown", function(e) {
      var ch = undefined;
      if (e.keyCode == 13) ch = String.fromCharCode(13);
      if (e.ctrlKey) {
        if (e.keyCode == 'C'.charCodeAt(0)) ch = String.fromCharCode(3); // control C
        if (e.keyCode == 'F'.charCodeAt(0)) {
          // fullscreen
          e.preventDefault();
          var term = document.querySelector(".editor__canvas__terminal");
          if (term.classList.contains("editor__canvas__fullscreen")) {
            // was fullscreen - make windowed
            term.classList.remove("editor__canvas__fullscreen");
            document.querySelector(".editor--terminal").append(term)
          } else {
            term.classList.add("editor__canvas__fullscreen");
            document.body.append(term);
          }
          // if we have a webcam it seems we need to start it playing again
          // after moving it
          var vid = document.querySelector("video");
          if (vid) vid.play();
        }
      }
      if (e.altKey) {
        if (e.keyCode == 13) ch = String.fromCharCode(27,10); // Alt enter
      }
      if (e.keyCode == 8) ch = "\x08"; // backspace
      if (e.keyCode == 9) ch = "\x09"; // tab
      if (e.keyCode == 46) ch = String.fromCharCode(27,91,51,126); // delete
      if (e.keyCode == 38) ch = String.fromCharCode(27,91,65); // up
      if (e.keyCode == 40) ch = String.fromCharCode(27,91,66); // down
      if (e.keyCode == 39) ch = String.fromCharCode(27,91,67); // right
      if (e.keyCode == 37) ch = String.fromCharCode(27,91,68); // left
      if (e.keyCode == 36) ch = String.fromCharCode(27,79,72); // home
      if (e.keyCode == 35) ch = String.fromCharCode(27,79,70); // end
      if (e.keyCode == 33) ch = String.fromCharCode(27,91,53,126); // page up
      if (e.keyCode == 34) ch = String.fromCharCode(27,91,54,126); // page down

      if (ch!=undefined) {
        e.preventDefault();
        terminalfocus.value = "";
        lastValue = "";
        onInputData(ch);
      }
    });
    terminalfocus.addEventListener("paste", function() {
      // nasty hack - wait for paste to complete, then get contents of input
      setTimeout(function () {
        changeListener();
        terminalfocus.value = "";
        lastValue = "";
      }, 100);
    });

    // Ensure that data from Espruino goes to this terminal
    Espruino.Core.Serial.startListening(Espruino.Core.Terminal.outputDataHandler);

    Espruino.addProcessor("connected", function(data, callback) {
      grabSerialPort();
      terminal.classList.add("terminal--connected");
      callback(data);
    });
    Espruino.addProcessor("disconnected", function(data, callback) {
      // carriage return, clear to right - remove prompt, add newline
-     outputDataHandler("\n");
      terminal.classList.remove("terminal--connected");
      callback(data);
    });
    Espruino.addProcessor("notification", function(data, callback) {
      var elementClass = "terminal-status-"+data.type;
      var line = termCursorY;
      if (!termExtraText[line]) termExtraText[line]="";
      termExtraText[line] += '<div class="terminal-status-container"><div class="terminal-status '+elementClass+'">'+data.msg+'</div></div>';
      updateTerminal();
      callback(data);
    });

  };

  /// send the given characters as if they were typed
  var typeCharacters = function(s) {
    onInputData(s);
  }

  var clearTerminal = function() {
    // Get just the last entered line
    var currentLine = Espruino.Core.Terminal.getInputLine();
    if (currentLine==undefined)
      currentLine = { text : "", line : 0 };
    termText = currentLine.text.split("\n");
    // re-add > and : marks
    for (var l in termText)
      termText[l] = (l==0?">":":") + termText[l];
    // reset other stuff...
    termExtraText = {};
    // leave X cursor where it was...
    termCursorY -= currentLine.line; // move Y cursor back
    termControlChars = [];
    // finally update the HTML
    updateTerminal();
    // fire off a clear terminal processor
    Espruino.callProcessor("terminalClear");
  };

  var updateTerminal = function() {
    var terminal = $("#terminal");
    // gather a list of elements for each line
    elements = [];
    terminal.children().each(function() {
      var n = $(this).attr("lineNumber");
      if (n!==undefined)
        elements[n] = $(this);
      else
        $(this).remove(); // remove stuff that doesn't have a line number
    });

    // remove extra lines if there are too many
    if (termText.length > MAX_LINES) {
      var removedLines = termText.length - MAX_LINES;
      termText = termText.slice(removedLines);
      termCursorY -= removedLines;
      var newTermExtraText = {};
      for (var i in termExtraText) {
        if (i>=removedLines)
          newTermExtraText[i-removedLines] = termExtraText[i];
      }
      termExtraText = newTermExtraText;

      // now renumber our elements (cycle them around)
      var newElements = [];
      for (i in elements) {
        var n = elements[i].attr("lineNumber") - removedLines;
        if (n<0) { // if it's fallen off the bottom, delete it
          elements[i].remove();
        } else {
          elements[i].attr("lineNumber", n);
          newElements[n] = elements[i];
        }
      }
      elements = newElements;
    }
    // remove elements if we have too many...
    for (i=termText.length;i<elements.length;i++)
      if (i in elements)
        elements[i].remove();
    // now write this to the screen
    var t = [];
    for (var y in termText) {
      var line = termText[y];
      if (y == termCursorY) {
        var ch = Espruino.Core.Utils.getSubString(line,termCursorX,1);
        line = Espruino.Core.Utils.escapeHTML(
            Espruino.Core.Utils.getSubString(line,0,termCursorX)) +
            "<span class='terminal__cursor'>" + Espruino.Core.Utils.escapeHTML(ch) + "</span>" +
            Espruino.Core.Utils.escapeHTML(Espruino.Core.Utils.getSubString(line,termCursorX+1));
      } else {
        line = Espruino.Core.Utils.escapeHTML(line);
        // handle URLs
        line = line.replace(/(https?:\/\/[-a-zA-Z0-9@:%._\+~#=\/\?]+)/g, '<a href="$1" target="_blank">$1</a>');
      }
      // detect inline images and link them in
      var m = line.match(/data:image\/\w+;base64,[\w\+\/=]+/);
      if (m) {
        line = line.substr(0,m.index)+'<a href="'+m[0]+'" download><img class="terminal-inline-image" src="'+m[0]+'"/></a>'+line.substr(m.index+m[0].length);
      }

      // extra text is for stuff like tutorials
      if (termExtraText[y])
        line = termExtraText[y] + line;

      // Only update the elements if they need updating
      if (elements[y]===undefined) {
        var prev = y-1;
        while (prev>=0 && elements[prev]===undefined) prev--;
        elements[y] = $("<div class='termLine' lineNumber='"+y+"'>"+line+"</div>");
        if (prev<0) elements[y].appendTo(terminal);
        else elements[y].insertAfter(elements[prev]);
      } else if (elements[y].html()!=line)
        elements[y].html(line);
    }
    // now show the line where the cursor is
    if (elements[termCursorY]!==undefined) {
      terminal[0].scrollTop = elements[termCursorY][0].offsetTop;
    }
    /* Move input box to the same place as the cursor, so Android devices
    keep that part of the screen in view */
    var cursor = document.getElementsByClassName("terminal__cursor");
    if (cursor.length) {
      var pos = cursor[0].getBoundingClientRect();
      var terminalfocus = document.getElementById("terminalfocus");
      var x = Math.min(pos.left, terminal.offsetWidth);
      terminalfocus.style.left=x+"px";
      terminalfocus.style.top=pos.top+"px";
      terminalfocus.style["z-index"]=-100;
    }
  };

  function trimRight(str) {
    var s = str.length-1;
    while (s>0 && str[s]==" ") s--;
    return str.substr(0,s+1);
  }

  var handleReceivedCharacter = function (/*char*/ch) {
    //console.log("IN = "+ch);
    if (termControlChars.length==0) {
      switch (ch) {
        case  8 : {
          if (termCursorX>0) termCursorX--;
        } break;
        case 10 : { // line feed
          Espruino.callProcessor("terminalNewLine", termText[termCursorY]);
          termCursorX = 0; termCursorY++;
          while (termCursorY >= termText.length) termText.push("");
        } break;
        case 13 : { // carriage return
          termCursorX = 0;
        } break;
        case 27 : {
          termControlChars = [ 27 ];
        } break;
        case 19 : break; // XOFF
        case 17 : break; // XON
        case 0xC2 : break; // UTF8 for <255 - ignore this
        default : {
          // Else actually add character
          if (termText[termCursorY]===undefined) termText[termCursorY]="";
          termText[termCursorY] = trimRight(
              Espruino.Core.Utils.getSubString(termText[termCursorY],0,termCursorX) +
              String.fromCharCode(ch) +
              Espruino.Core.Utils.getSubString(termText[termCursorY],termCursorX+1));
          termCursorX++;
          // check for the 'prompt', eg '>' or 'debug>'
          // if we have it, send a 'terminalPrompt' message
          if (ch == ">".charCodeAt(0)) {
            var prompt = termText[termCursorY];
            if (prompt==">" || prompt=="debug>")
              Espruino.callProcessor("terminalPrompt", prompt);
          }
        }
      }
   } else if (termControlChars[0]==27) { // Esc
     if (termControlChars[1]==91) { // Esc [
       if (termControlChars[2]==63) {
         if (termControlChars[3]==55) {
           if (ch!=108)
             console.log("Expected 27, 91, 63, 55, 108 - no line overflow sequence");
           termControlChars = [];
         } else {
           if (ch==55) {
             termControlChars = [27, 91, 63, 55];
           } else termControlChars = [];
         }
       } else {
         termControlChars = [];
         switch (ch) {
           case 63: termControlChars = [27, 91, 63]; break;
           case 65: if (termCursorY > 0) termCursorY--; break; // up  FIXME should add extra lines in...
           case 66: termCursorY++; while (termCursorY >= termText.length) termText.push(""); break;  // down FIXME should add extra lines in...
           case 67: termCursorX++; break; // right
           case 68: if (termCursorX > 0) termCursorX--; break; // left
           case 74: termText[termCursorY] = termText[termCursorY].substr(0,termCursorX); // Delete to right + down
                    termText = termText.slice(0,termCursorY+1);
                    break;
           case 75: termText[termCursorY] = termText[termCursorY].substr(0,termCursorX); break; // Delete to right
         }
       }
     } else {
       switch (ch) {
         case 91: {
           termControlChars = [27, 91];
         } break;
         default: {
           termControlChars = [];
         }
       }
     }
   } else termControlChars = [];
};


// ----------------------------------------------------------------------------------------------------------
// ----------------------------------------------------------------------------------------------------------
// ----------------------------------------------------------------------------------------------------------

  /// Set the callback(String) that gets called when the user presses a key. Returns the old one
  function setInputDataHandler( callback ) {
    var old = onInputData;
    onInputData = callback;
    return old;
  };

  /// Called when data comes OUT of Espruino INTO the terminal
  function outputDataHandler(readData) {
    if ("string" == typeof readData)
      readData = readData.split("").map(function(x) {return x.charCodeAt();});
    // Add data to our buffer
    var bufView=new Uint8Array(readData);
    searchData(bufView);
    for (var i=0;i<bufView.length;i++)
      displayData.push(bufView[i]);
    // If we haven't had data after 50ms, update the HTML
    if (displayTimeout == null)
      displayTimeout = window.setTimeout(function() {
        for (i in displayData)
          handleReceivedCharacter(displayData[i]);
        updateTerminal();
        displayData = [];
        displayTimeout = null;
      }, 50);
  };

  var receivedData = "";
  function searchData(bytes){
    var si,ei;
    for(var i = 0; i < bytes.length; i++) {
      receivedData += String.fromCharCode(bytes[i]);
    }
    si = receivedData.indexOf("<<<<<");
    if(si >= 0){
      receivedData = receivedData.substr(si);
      ei = receivedData.indexOf(">>>>>");
      if(ei > 0){
        receivedData = receivedData.substr(5,ei - 5);
        Espruino.callProcessor("getWatched",receivedData,function(){});
        receivedData = "";
      }
    }
    else{ receivedData = ""; }
  }

  /// Claim input and output of the Serial port
  function grabSerialPort() {
    // Ensure that keypresses go direct to the Espruino device
    Espruino.Core.Terminal.setInputDataHandler(function(d) {
      Espruino.Core.Serial.write(d);
    });
    // Ensure that data from Espruino goes to this terminal
    Espruino.Core.Serial.startListening(Espruino.Core.Terminal.outputDataHandler);
  };

  /// Get the current terminal line that we're on
  function getCurrentLine() {
    return termText.length-1;
  };

  /// Set extra text to display before a certain terminal line
  function setExtraText(line, text) {
    if (termExtraText[line] != text) {
      termExtraText[line] = text;
      updateTerminal();
    }
  };

  /// Clear all extra text that is to be displayed
  function clearExtraText() {
    termExtraText = {};
    updateTerminal();
  };

  /// Does the terminal have focus?
  function hasFocus() {
    return document.querySelector("#terminal").classList.contains("focus");
  };

  /// Give the terminal focus
  function focus() {
    $("#terminalfocus").focus();
  };

  // Is the terminal actually visible, or is it so small it can't be seen?
  function isVisible() {
    return ($("#terminal").width() > 20) && ($("#terminal").height() > 20);
  }

  /** Get the Nth from latest terminal line (and the line number of it). 0=current line.
   * By terminal line we mean a line starting with '>' */
  function getInputLine(n) {
    if (n===undefined) n=0;
    var startLine = termText.length-1;
    while (startLine>=0 && !(n==0 && termText[startLine].substr(0,1)==">")) {
      if (termText[startLine].substr(0,1)==">") n--;
      startLine--;
    }
    if (startLine<0) return undefined;
    var line = startLine;
    var text = termText[line++].substr(1);
    while (line < termText.length && termText[line].substr(0,1)==":")
      text += "\n"+termText[line++].substr(1);
    return { line : startLine, text : text };
  };

  /** Get the Nth from latest line of text in the terminal (unlike getInputLine) */
  function getTerminalLine(n) {
    if (n===undefined) n=0;
    var line = termText.length-(1+n);
    if (line<0) return undefined;
    return termText[line];
  };

  /** Add a notification to the terminal (as HTML). If options.buttonclick is set
  then the first <button> inside the notification text
  will have a click handler registered*/
  function addNotification(text, options) {
    options = options||{};
    var line = getInputLine(0);
    line = (line===undefined)?0:line.line;
    if (!termExtraText[line]) termExtraText[line]="";
    termExtraText[line] += '<div class="notification_text">'+text+'</div>';
    updateTerminal();
    if (options.buttonclick) {
      var btn = elements[line].find("button");
      if (!btn.length) console.error("Espruino.Core.Terminal buttonclick set but no button");
      btn.on('click', options.buttonclick);
    }
  }

  Espruino.Core.Terminal = {
      init : init,

      getInputLine : getInputLine,
      getTerminalLine : getTerminalLine,
      getCurrentLine : getCurrentLine,
      isVisible : isVisible, // Is the terminal actually visible, or is it so small it can't be seen?
      hasFocus : hasFocus, // Does the termninal have focus?
      focus : focus, // Give this focus
      clearTerminal : clearTerminal, // Clear the contents of the terminal

      setExtraText : setExtraText,
      clearExtraText : clearExtraText,
      addNotification : addNotification, // wrapper around setExtraText to add advice to the terminal

      grabSerialPort : grabSerialPort,
      setInputDataHandler : setInputDataHandler,
      outputDataHandler : outputDataHandler,
      typeCharacters : typeCharacters
  };

})();
