(function() {

var dataToSend = "";
var soundDebugFn = undefined;

  function init() {
// Fix up prefixing
window.AudioContext = window.AudioContext || window.webkitAudioContext;
navigator.getUserMedia = navigator.getUserMedia || navigator.webkitGetUserMedia || navigator.mozGetUserMedia;
var context = new AudioContext();

if (!navigator.getUserMedia) {
  alert("Error: getUserMedia not supported!");
  return;
}

var inputNode = context.createScriptProcessor(2048, 1/*in*/, 1/*out*/);
window.dontGarbageCollectMePlease = inputNode;
console.log("Audio Sample rate : "+context.sampleRate);
var BAUD = 9600;
var bitTime = context.sampleRate / BAUD; // intentionally a float
console.log("Baud", BAUD, "Bit time", bitTime);

var inSamples = undefined;
var inSampleCounter = 0;

var outSampleCounter = 0;
var outSample = undefined;

var lastBitValue = 1;

inputNode.onaudioprocess = function(e) { 
  var data = e.inputBuffer.getChannelData(0);
  var dataout = e.outputBuffer.getChannelData(0);
  dataout.set(data);
  var bits = new Array(data.length);
  for (var i = 0; i < data.length; ++i) {
    var bitValue = data[i] > -0.2;
    bits[i] = bitValue;
  }

  for (var i = 0; i < data.length; ++i) {
    // -------------------------------------------- Input
    var value = bits[i];    
    // if we've counted past a bit
     if (inSampleCounter >= bitTime || 
        ((value!=lastBitValue) && (inSamples===undefined || inSampleCounter>=bitTime/2))) {
      inSampleCounter -= bitTime;
      if (inSamples===undefined) {
        // detect start bit, else ignore
        if (!lastBitValue) {
          inSamples="";
          // draw our waveform
          if (soundDebugFn) {
            var d = [], d2 = [], d3 = [], d4 = [];
            var lookAhead = 500;
            for (var x=0;x<1000;x++) {
              d[x] = data[i+x-lookAhead];
              d2[x] = bits[i+x-lookAhead]/2;
            }
            soundDebugFn(d,d2);
          }
        }
      } else {
        inSamples = (lastBitValue?"1":"0") + inSamples;
        if (inSamples.length>=9) {
          // STOP,D7,D6,D5,D4,D3,D2,D1,D0
          var byteData = inSamples.substr(-8); // extract D7..D0
          var byteVal = parseInt(byteData,2);
          console.log(byteData, byteVal, String.fromCharCode(byteVal));
          if (readListener)
            readListener(String.fromCharCode(byteVal));
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
    // -------------------------------------------- Output 
    if (outSample===undefined && dataToSend.length&& i>100) { 
      outSample = (dataToSend.charCodeAt(0)<<1) | 512;
      // Start bit of 0, data, then stop bit of 1
      dataToSend = dataToSend.substr(1);
      outSampleCounter = 0;      
    }
    if (outSample!==undefined) {
      dataout[i] = (outSample &(1<<Math.floor(outSampleCounter/bitTime))) ? -1 : 1;
      outSampleCounter++;
      if (outSampleCounter >= bitTime*10) {
        outSample = undefined; // stop output of byte
      }
    } else
      dataout[i] = -1; // idle state
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
  };
})();


