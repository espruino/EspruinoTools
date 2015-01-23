(function() {

// Fix up prefixing
if (typeof window == "undefined") return; // not running in a web browser
window.AudioContext = window.AudioContext || window.webkitAudioContext;
if (!window.AudioContext) return; // no audio available
navigator.getUserMedia = navigator.getUserMedia || navigator.webkitGetUserMedia || navigator.mozGetUserMedia;

var dataToSend = "";
var soundDebugFn = undefined;

var soundInputPolarity = -1;
var soundOutputPolarity = -1;

  function init() {
var context = new AudioContext();

if (!navigator.getUserMedia) {
  alert("Error: getUserMedia not supported!");
  return;
}

var inputNode = context.createScriptProcessor(4096, 1/*in*/, 1/*out*/);
window.dontGarbageCollectMePlease = inputNode;
console.log("Audio Sample rate : "+context.sampleRate);
var BAUD = 9600;
var bitTime = context.sampleRate / BAUD; // intentionally a float
console.log("Baud", BAUD, "Bit time", bitTime);

// Used when getting data from sound
var inSamples = undefined; // data received
var inSampleCounter = 0; // number of samples while value is the same (==bits)

// Used when creating sounds from data
var outSampleCounter = 0;
var outSample = undefined;

var lastBitValue = 1;
var minValue = 0; // a running minimum value so we can take account of the capacitor

inputNode.onaudioprocess = function(e) { 
  var data = e.inputBuffer.getChannelData(0);
  var dataout = e.outputBuffer.getChannelData(0);
 
  var charactersRead = "";

  for (var i = 0; i < data.length; ++i) {
    // -------------------------------------------- Input
    var dataValue = data[i]*soundInputPolarity;
    // work out what our bit is... 
    // keep track of the minimum (actually the max - sig is inverted)
    // then when signal is a bit above(below) that, it's a 1    
    var value = dataValue < (minValue+0.1);    
    minValue += 0.002;
    if (dataValue < minValue) minValue = dataValue;

    // if we've counted past a bit
     if (inSampleCounter >= bitTime || 
        ((value!=lastBitValue) && (inSamples===undefined || inSampleCounter>=bitTime/2))) {
      inSampleCounter -= bitTime;
      if (inSamples===undefined) {
        // detect start bit, else ignore
        if (!lastBitValue)
          inSamples="";
      } else {
        inSamples = (lastBitValue?"1":"0") + inSamples;
        if (inSamples.length>=9) {
          // STOP,D7,D6,D5,D4,D3,D2,D1,D0
          var byteData = inSamples.substr(-8); // extract D7..D0
          var byteVal = parseInt(byteData,2);
//        console.log(byteData, byteVal, String.fromCharCode(byteVal));
          charactersRead += String.fromCharCode(byteVal);
          inSamples=undefined; // wait for next start bit
        }
      }
    } 
    // if the value has changed, reset our sample counter
    if (value!=lastBitValue) {
      inSampleCounter = 0;
    }
    inSampleCounter++;
    lastBitValue = value;
  

    // ---------------------------------------------------------------------
    // -------------------------------------------- Output 
    if (outSample===undefined && dataToSend.length&& i>100) { 
      outSample = (dataToSend.charCodeAt(0)<<1) | 512;
      // Start bit of 0, data, then stop bit of 1
      dataToSend = dataToSend.substr(1);
      outSampleCounter = 0;      
    }
    if (outSample!==undefined) {
      dataout[i] = (outSample &(1<<Math.floor(outSampleCounter/bitTime))) ? soundOutputPolarity : -soundOutputPolarity;
      outSampleCounter++;
      if (outSampleCounter >= bitTime*10) {
        outSample = undefined; // stop output of byte
      }
    } else
      dataout[i] = soundOutputPolarity; // idle state = 1
  }

  // print debug information
  if (soundDebugFn) {
    var sum = 0;
    var bits = new Array(data.length);
    var mv = new Array(data.length);
    for (var i = 0; i < data.length; ++i) {  
      // just what we do above
      var value = dataValue < (minValue+0.1);    
      minValue += 0.002;
      if (dataValue < minValue) minValue = dataValue;
      bits[i] = value;
      mv[i] = minValue;
      sum += data[i]*data[i];
    }

    if (sum>0.01*data.length) {
      setTimeout(function() {
        soundDebugFn(data,mv);
      }, 10);
    }
  }

  // call our listener if we've got characters in
  if (charactersRead && readListener) {
    setTimeout(function() {
      readListener(charactersRead);
    }, 10);
  }
};

navigator.getUserMedia({
  video:false,
  audio:{
    mandatory:[],
    optional:[{ echoCancellation:false },{sampleRate:44100}]
  }
}, function(stream) {
  var inputStream = context.createMediaStreamSource(stream);
  inputStream.connect(inputNode);
  inputNode.connect(context.destination);
}, function(e) {
  alert('Error getting audio');
  console.log(e);
});
  }  
  
  var connected = false;
  var readListener;

  
  var startListening=function(callback) {
    var oldListener = readListener;
    readListener = callback;
    return oldListener;
  };

  var getPorts=function(callback) {
    callback(["Audio"]);
  };
  
  var openSerial=function(serialPort, openCallback, disconnectCallback) {
    connected = true;
    Espruino.callProcessor("connected", undefined, function() {       
      openCallback("Hello");
    });          
  };

 
  var closeSerial=function(callback) {
    connected = false;
    Espruino.callProcessor("disconnected");
    if (callback!==undefined) callback();
  };
   
  var isConnected = function() {
    return connected;
  };

  // Throttled serial write
  var writeSerial = function(data, showStatus) {
    if (!isConnected()) return; // throw data away
    dataToSend += data;
  };
  
  // ----------------------------------------------------------

  Espruino.Core.Serial = {
    "init" : init,
    "getPorts": getPorts,
    "open": openSerial,
    "isConnected": isConnected,
    "startListening": startListening,
    "write": writeSerial,
    "close": closeSerial,
	"isSlowWrite": function() { return slowWrite; },
	"setSlowWrite": function(isOn, force) { 
        if ((!force) && Espruino.Config.SERIAL_THROTTLE_SEND) {
          console.log("ForceThrottle option is set - set Slow Write = true");
          isOn = true;
        } else
  	    console.log("Set Slow Write = "+isOn);
	  slowWrite = isOn; 
	},
   "setSoundDebugFunction": function(fn) { 
     soundDebugFn = fn; 
   },
  "setSoundPolarity": function(rxPol, txPol) {  // either 1 or -1
     soundInputPolarity = rxPol;
     soundOutputPolarity = txPol;
   },
  };
})();


