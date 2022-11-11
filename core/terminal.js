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

  /* we don't update the terminal as soon as new data arrives as that might block
  it, so instead we wait a while using displayTimeout */
  var displayTimeout = null;
  var displayData = [];

  /* If images are displayed inline, we want to convert them from BMP to
  PNG - but we don't want to do that as they are displayed because they
  keep being updated over and over as data arrives. Instead, update
  after a delay. */
  var imageTimeout = null;

  // Text to be displayed in the terminal as array holding lines of text
  var termText = [ "" ];
  var termCursorX = 0;
  var termCursorY = 0;

  // Map of terminal line number to text to display before it
  var termExtraText = {};
  
  // List of (jquerified) DOM elements for each line
  var elements = [];

  // current control character sequence as string
  var termControlChars = '';

  // maximum lines on the terminal
  var MAX_LINES = 2048;

  // mapping of display attribute type/ID to HTML in line style - in response to ANSI Seq - esc [ ... 
  const attributes = [                                                  
    {ID:0,name:'resetAll',styleStr:''},                                    //  0m resets all
    {ID:1,name:'foregroud',styleStr:'color:'},         //styleStr+colour  30->37m set, 39m clear 
    {ID:2,name:'bold',styleStr:'font-weight:'},        //styleStr+'bolder'     1m set, 22m clear 
 // {ID:2,name:'faint',styleStr:'font-weight:'},         styleStr+'lighter'    2m set, 22m clear 
    {ID:3,name:'italic',styleStr:'font-style:italic'},                     //  3m set, 23m clear  
    {ID:4,name:'underline',styleStr:'text-decoration:underline'},          //  4m set, 24m clear 
    {ID:5,name:'crossedOut',styleStr:'text-decoration:line-through'},      //  9m set, 29m clear 
    {ID:6,name:'background',styleStr:'background-color:'} //style+colour  40->47 set, 49 clear 
  ]

  /* Display Attributes of each termText line as array of array of objects
     set during recievedCharacter() processing.  object properties: 
       seq: int - sequence order of attribute in termtext line
       pos: int - character position of style on termtext line
       type: int - type of attribute corresponding to attribute ID
       value: string - parameter (depending on type) eg reset,on,off,colour
  */
  var termAttribute = [];  

  /* Styles currently active during HTML creation. As array:
     index = ID-1 of corresponding attribute  
     value (string) = undefined || complete style string (as per attributes[]) inc colour/font weight value
  */
  var activeStyles = [];

  const fullModalAttribs = true; //set true then any active attribute styles carry to new lines

  // map of ANSI display attribute colours for code 0->7,  index = code
  const colorMap = ["black","red","green","yellow","blue","magenta","cyan","white"];
  
  // updates active style for a termAttribute object
  function setActiveStyles(obj){
    switch (obj.value) {
      case 'reset' : activeStyles = [] ; break;
      case 'on' : activeStyles[obj.type-1] = attributes[obj.type].styleStr ; break;
      case 'off' : activeStyles[obj.type-1] = undefined ; break;
      default : activeStyles[obj.type-1] = attributes[obj.type].styleStr + obj.value; break;
    }
  }

  function init()
  {
    // Add stuff we need
    $('<div id="terminal" class="terminal"></div>').appendTo(".editor--terminal .editor__canvas");
    $('<textarea id="terminalfocus" class="terminal__focus" rows="1" cols="1"></textarea>').appendTo(document.body);

    var terminal = document.getElementById("terminal");
    var terminalfocus = document.getElementById("terminalfocus");
    if (terminal === null) {
      console.log("Terminal: terminal element not found, aborting.");
      delete Espruino.Core.Terminal;
      return;
    }

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

  /* check for any terminal-inline-image and if they are still BMP
  then convert them to PNG using canvas */
  function convertInlineImages() {
    imageTimeout = null;
    var images = document.getElementsByClassName("terminal-inline-image");
    for (var i=0;i<images.length;i++)
      (function(img) {
        if (img.src.startsWith("data:image/bmp;")) {
          // still a BMP
          var oImage = new Image();
          oImage.onload = function(){
            var oCanvas = document.createElement('canvas');
            oCanvas.width = oImage.width;
            oCanvas.height = oImage.height;
            var oCtx = oCanvas.getContext('2d');
            oCtx.drawImage(oImage, 0, 0);
            var url = oCanvas.toDataURL();
            img.src = url;
            img.parentElement.href = url;
          }
          oImage.src = img.src;
        }
      })(images[i]);
  }

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
    termAttribute = [];
    termExtraText = {};
    // leave X cursor where it was...
    termCursorY -= currentLine.line; // move Y cursor back
    termControlChars = '';
    // finally update the HTML
    updateTerminal();
    // fire off a clear terminal processor
    Espruino.callProcessor("terminalClear");
  };

 /**
  * function buildAttribSpans 
  * returns {string} updated line with HTML spans created to style as per corresponding line attributes 
  *                  with text elements in line Escaped via Utils.escapeHTML()
  * param {string} line - line form termText[]
  * param {array of objects} attribs - line attributes as defined in termAttribute[] for the line of text 
  */
  var buildAttribSpans = function (line, attribs) {
    // full modal mode uses any current attribte styles set on previous lines 
    if (!fullModalAttribs && !attribs) return Espruino.Core.Utils.escapeHTML(line);
    if (!attribs) return  "<span style=" + activeStyles.join(";") + ">" + Espruino.Core.Utils.escapeHTML(line) + "</span>" ;

    var result = attribs.reduce(function (acc, obj, i, arr) {
      setActiveStyles(obj);
      let end = !arr[i + 1] ? line.length : arr[i + 1].pos;
      if (end == obj.pos) return acc; // no text just styles
      return (
        acc +
        "<span style=" +
        activeStyles.join(";") +
        ">" +
        Espruino.Core.Utils.escapeHTML(line.slice(obj.pos, end)) +
        "</span>"
      );
    }, Espruino.Core.Utils.escapeHTML(line.slice(0, attribs[0].pos)));  // initial value is any text before first attribute position
    return result;
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
      termAttribute = termAttribute.slice(removedLines);
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
      if (y == termCursorY) {  // current line 
        var ch = Espruino.Core.Utils.getSubString(line,termCursorX,1);
        line = Espruino.Core.Utils.escapeHTML(
            Espruino.Core.Utils.getSubString(line,0,termCursorX)) +
            "<span class='terminal__cursor'>" + Espruino.Core.Utils.escapeHTML(ch) + "</span>" +
            Espruino.Core.Utils.escapeHTML(Espruino.Core.Utils.getSubString(line,termCursorX+1));
      } else {
        line = buildAttribSpans(line,termAttribute[y]);
        // handle URLs
        line = line.replace(/(https?:\/\/[-a-zA-Z0-9@:%._\+~#=\/\?]+)/g, '<a href="$1" target="_blank">$1</a>');
      }
      // detect inline images and link them in
      var m = line.match(/data:image\/\w+;base64,[\w\+\/=]+/);
      if (m) {
        var src = m[0];
        line = line.substr(0,m.index)+'<a href="'+src+'" download><img class="terminal-inline-image" src="'+src+'"/></a>'+line.substr(m.index+m[0].length);
        if (imageTimeout) clearTimeout(imageTimeout);
        imageTimeout = setTimeout(convertInlineImages, 1000);
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

  // Add Character string  (str) to termText for output
  var addCharacters = function (str){
    if (termText[termCursorY]===undefined) termText[termCursorY]="";
    termText[termCursorY] = trimRight(
        Espruino.Core.Utils.getSubString(termText[termCursorY],0,termCursorX) +
        str +
        Espruino.Core.Utils.getSubString(termText[termCursorY],termCursorX+1));
    termCursorX = termCursorX+str.length;
    // check for the 'prompt', eg '>' or 'debug>'
    // if we have it, send a 'terminalPrompt' message
   // if (str == ">".charCodeAt(0)) {
    if (str == ">" ) {
      var prompt = termText[termCursorY];
      if (prompt==">" || prompt=="debug>")
        Espruino.callProcessor("terminalPrompt", prompt);
    }
  }

  var handleReceivedCharacter = function (/*char*/ch) {
    switch (termControlChars.length) {
      case 0 : {
        switch (ch) {
          case  8 : // BS
            if (termCursorX>0) termCursorX--;
            break;
          case 10 : // line feed
            Espruino.callProcessor("terminalNewLine", termText[termCursorY]);
            termCursorX = 0; termCursorY++;
            while (termCursorY >= termText.length) termText.push("");
            break;
          case 13 : // carriage return
            termCursorX = 0;
            break;
          case 27 : // Esc
            termControlChars = String.fromCharCode(27);
            break;
          case 19 : break; // XOFF
          case 17 : break; // XON
          case 0xC2 : break; // UTF8 for <255 - ignore this
          default : addCharacters(String.fromCharCode(ch));  // Else actually add character
        }
        break;
      }
      case 1 : 
        if (termControlChars == '\x1B')  // Esc 
          switch (ch) {
            case 91: termControlChars += '['; break; // Esc [
            default: termControlChars = '';
        } else termControlChars = '';
        break;
      case 2 : 
        if (termControlChars == '\x1B[') { // Esc [ 
          switch (ch) {
            case 63: termControlChars += '?'; break; // Esc [ ?
            case 65: // up  
              if (termCursorY > 0) termCursorY--; 
              termControlChars = '';
              break; // old FIXME should add extra lines in...
            case 66: // down 
              termCursorY++; 
              while (termCursorY >= termText.length) termText.push(""); 
              termControlChars = '';
              break; // old FIXME should add extra lines in...
            case 67: //right
              termCursorX++;
              termControlChars = ''; 
              break; 
            case 68: // left
              if (termCursorX > 0) termCursorX--;
              termControlChars = '';  
              break; 
            case 74: // Delete to right + down
              termText[termCursorY] = termText[termCursorY].substr(0,termCursorX); 
              termText = termText.slice(0,termCursorY+1);
              termControlChars = ''; 
              break;
            case 75: // K Delete to right
              termText[termCursorY] = termText[termCursorY].substr(0,termCursorX);
              termControlChars = '';  
              break;
            default: 
              termControlChars += String.fromCharCode(ch)
              if (/\x1B\[[0-49]/.test(termControlChars))  break;  // setting display attribute - more to come
              termControlChars = ''; 
            }
       } else termControlChars = '';
       break;
      case 3 :
        termControlChars += String.fromCharCode(ch); 
        if (/\x1B\[\?7/.test(termControlChars))  break;        // Esc [ ? 7  - line overflow sequence - more to come
        if (/\x1B\[[34][0-79]/.test(termControlChars)) break;  // colour device attribute - more to come
        if (/\x1B\[[2][2349]/.test(termControlChars)) break;   // device attribute - more to come

        if (/\x1B\[0m/.test(termControlChars)) {  //reset all - add to term line attributes  
          termAttribute[termCursorY] = !termAttribute[termCursorY] 
            ? [].concat({seq:0,pos:termCursorX,type:0,value:'reset'}) 
            : termAttribute[termCursorY].concat({seq:termAttribute[termCursorY].length,pos:termCursorX,type:0,value:'reset'})
          termControlChars = ''; 
          break;  
        }
        if (/\x1B\[[12]m/.test(termControlChars)) {  //set bold/faint text - add to term line attribute
          let  weight = termControlChars.slice(2,3)==1? 'bolder': 'lighter';
          termAttribute[termCursorY] = !termAttribute[termCursorY] 
            ? [].concat({seq:0,pos:termCursorX,type:2,value:weight}) 
            : termAttribute[termCursorY].concat({seq:termAttribute[termCursorY].length,pos:termCursorX,type:2,value:weight})
          termControlChars = ''; 
          break;  
        }
        if (/\x1B\[[349]m/.test(termControlChars)) {  //set italic/underline/line-thru - add to term line attributes 
          let attribType = termControlChars.slice(2,3)=='9'? 5: +termControlChars.slice(2,3);
          termAttribute[termCursorY] = !termAttribute[termCursorY] 
            ? [].concat({seq:0,pos:termCursorX,type:attribType,value:'on'}) 
            : termAttribute[termCursorY].concat({seq:termAttribute[termCursorY].length,pos:termCursorX,type:attribType,value:'on'})
          termControlChars = ''; 
          break;  
        }
        termControlChars = '';  
        break;  
      case 4 :
        termControlChars += String.fromCharCode(ch);  
        if (/\x1B\[\?7/.test(termControlChars)) { // Esc [ ? 7  
          if (ch!=108) {                          // Esc [ ? 7 l
            console.log("Expected 27, 91, 63, 55, 108 - no line overflow sequence");
          }
          termControlChars = '';  // got Esc [ ? 7 l  or not - reset term control chars 
          break;
        }
        if (/\x1B\[[3][0-7]m/.test(termControlChars)) {  //set foreground colour - add to term line attributes
          termAttribute[termCursorY] = !termAttribute[termCursorY]      
            ? [].concat( {seq:0,pos:termCursorX,type:1,value:colorMap[termControlChars.slice(3,4)]})
            : termAttribute[termCursorY].concat( {seq:termAttribute[termCursorY].length,pos:termCursorX,type:1,value:colorMap[termControlChars.slice(3,4)]})
          termControlChars = '';
          break;
        }
        if (/\x1B\[[4][0-7]m/.test(termControlChars)) {  //set background colour - add to term line attributes
          termAttribute[termCursorY] = !termAttribute[termCursorY] 
            ? [].concat( {seq:0,pos:termCursorX,type:6,value:colorMap[termControlChars.slice(3,4)]}) 
            : termAttribute[termCursorY].concat( {seq:termAttribute[termCursorY].length,pos:termCursorX,type:6,value:colorMap[termControlChars.slice(3,4)]})
          termControlChars = '';
          break;
        }
        if (/\x1B\[2[2349]m/.test(termControlChars)) {  //turn off fontWeight(bold,faint)/italic/underline/line-thru - add to term line attributes
          let attribType = termControlChars.slice(3,4)=='9'? 5: +termControlChars.slice(3,4);
          termAttribute[termCursorY] = !termAttribute[termCursorY] 
            ? [].concat( {seq:0,pos:termCursorX,type:attribType,value:'off'}) 
            : termAttribute[termCursorY].concat( {seq:termAttribute[termCursorY].length,pos:termCursorX,type:attribType,value:'off'})
          termControlChars = '';
          break;
        }
        if (/\x1B\[[34]9m/.test(termControlChars)) {  //turn off foreground/background colour - add to term line attributes
          let attribType = termControlChars.slice(2,3)=='3'? 1: 6;
          termAttribute[termCursorY] = !termAttribute[termCursorY]      
            ? [].concat( {seq:0,pos:termCursorX,type:attribType,value:'off'})
            : termAttribute[termCursorY].concat( {seq:termAttribute[termCursorY].length,pos:termCursorX,type:attribType,value:'off'})
          termControlChars = '';
          break;
        }
      default: termControlChars = '';
    }
  }

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
  will have a click handler registered

  options = {
      buttonclick // callback for if clicked
      noBorder // don't wrap in a green notification border
  }
  */
  function addNotification(text, options) {
    options = options||{};
    var line = getInputLine(0);
    line = (line===undefined)?0:line.line;
    if (!termExtraText[line]) termExtraText[line]="";
    if (!options.noBorder)
      text = '<div class="notification_text">'+text+'</div>';
    termExtraText[line] += text;
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
