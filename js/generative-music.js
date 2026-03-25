(function () {
  'use strict';

  /* ════════════════════════════════
     SHARED AUDIO CONTEXT
  ════════════════════════════════ */
  var audioCtx = null;

  function getCtx() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    return audioCtx;
  }

  function resumeCtx() {
    var ctx = getCtx();
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  /* ════════════════════════════════
     LUCIER MODULE
  ════════════════════════════════ */

  var lucierState = {
    sourceType:  'generated',
    roomSize:    'medium',
    iterations:  [],      // array of AudioBuffers — index 0 is the original
    currentIter: 0,
    isPlaying:   false,
    isRecording: false,
    isProcessing: false
  };

  var lucierSource    = null;
  var lucierGain      = null;
  var mediaRecorder   = null;
  var recordedChunks  = [];

  /* Room resonant frequency sets */
  var ROOM_FREQS = {
    small:  [380, 620, 900, 1350, 1800, 2400],
    medium: [210, 380, 580, 850,  1200, 1600],
    large:  [90,  180, 320, 500,  750,  1100]
  };

  /* Q values per room */
  var ROOM_Q = { small: 18, medium: 22, large: 28 };

  /* Gain per iteration pass (prevents clipping) */
  var ITER_GAIN = 0.78;

  /* ── Generate a vowel-like starting buffer ── */
  function generateVoiceBuffer(ctx) {
    var sr       = ctx.sampleRate;
    var dur      = 2.5; // seconds
    var len      = Math.floor(sr * dur);
    var src      = ctx.createBuffer(1, len, sr);
    var raw      = src.getChannelData(0);

    /* Pink noise */
    var b0=0,b1=0,b2=0,b3=0,b4=0,b5=0,b6=0;
    for (var i = 0; i < len; i++) {
      var w = Math.random() * 2 - 1;
      b0=0.99886*b0+w*0.0555179; b1=0.99332*b1+w*0.0750759;
      b2=0.96900*b2+w*0.1538520; b3=0.86650*b3+w*0.3104856;
      b4=0.55000*b4+w*0.5329522; b5=-0.7616*b5-w*0.0168980;
      raw[i] = (b0+b1+b2+b3+b4+b5+b6+w*0.5362)*0.12;
      b6=w*0.115926;
    }

    /* Amplitude envelope: short attack, long sustain, short decay */
    var attackSamples  = Math.floor(sr * 0.08);
    var decaySamples   = Math.floor(sr * 0.25);
    for (var i = 0; i < attackSamples; i++) raw[i] *= i / attackSamples;
    for (var i = 0; i < decaySamples; i++) {
      raw[len - 1 - i] *= i / decaySamples;
    }

    /* Apply formant filters offline to shape the noise into a vowel approximation */
    return applyFormants(ctx, src);
  }

  /* Apply formant filters to a buffer, return Promise<AudioBuffer> */
  function applyFormants(ctx, buf) {
    var sr  = ctx.sampleRate;
    var len = buf.length;
    var off = new OfflineAudioContext(1, len, sr);
    var src = off.createBufferSource();

    /* Copy buffer into offline context */
    var copy = off.createBuffer(1, len, sr);
    copy.getChannelData(0).set(buf.getChannelData(0));
    src.buffer = copy;

    /* Formants for "ah" vowel: F1=730Hz, F2=1090Hz, F3=2440Hz */
    var formants = [
      { freq: 730,  Q: 8 },
      { freq: 1090, Q: 6 },
      { freq: 2440, Q: 5 }
    ];

    var masterGain = off.createGain();
    masterGain.gain.value = 0.7;
    masterGain.connect(off.destination);

    formants.forEach(function (f) {
      var flt = off.createBiquadFilter();
      flt.type = 'bandpass';
      flt.frequency.value = f.freq;
      flt.Q.value = f.Q;
      src.connect(flt);
      flt.connect(masterGain);
    });

    src.start(0);
    return off.startRendering();
  }

  /* ── Apply one room iteration to current buffer ── */
  function applyIteration(inputBuf, roomSize, callback) {
    var freqs = ROOM_FREQS[roomSize];
    var q     = ROOM_Q[roomSize];
    var sr    = inputBuf.sampleRate;
    var len   = inputBuf.length;
    var off   = new OfflineAudioContext(1, len, sr);

    var src = off.createBufferSource();
    var copy = off.createBuffer(1, len, sr);
    copy.getChannelData(0).set(inputBuf.getChannelData(0));
    src.buffer = copy;

    var masterGain = off.createGain();
    masterGain.gain.value = ITER_GAIN;
    masterGain.connect(off.destination);

    freqs.forEach(function (freq) {
      var flt = off.createBiquadFilter();
      flt.type = 'bandpass';
      flt.frequency.value = freq;
      flt.Q.value = q;
      src.connect(flt);
      flt.connect(masterGain);
    });

    src.start(0);

    off.startRendering().then(function (rendered) {
      callback(null, rendered);
    }).catch(function (err) {
      callback(err);
    });
  }

  /* ── Play a buffer ── */
  function lucierPlay() {
    if (lucierState.iterations.length === 0) return;
    lucierStopPlayback();

    var ctx = resumeCtx();
    var buf = lucierState.iterations[lucierState.currentIter];

    lucierGain  = ctx.createGain();
    lucierGain.gain.value = 0.75;
    lucierGain.connect(ctx.destination);

    lucierSource = ctx.createBufferSource();
    lucierSource.buffer = buf;
    lucierSource.connect(lucierGain);
    lucierSource.onended = function () {
      lucierState.isPlaying = false;
      var btn = document.getElementById('lucier-play');
      btn.innerHTML = '&#9654;&#xFE0E; play';
      btn.classList.remove('on');
    };
    lucierSource.start();
    lucierState.isPlaying = true;

    var btn = document.getElementById('lucier-play');
    btn.innerHTML = '&#9632;&#xFE0E; stop';
    btn.classList.add('on');
  }

  function lucierStopPlayback() {
    if (lucierSource) {
      try { lucierSource.stop(); } catch(e) {}
      lucierSource = null;
    }
    lucierState.isPlaying = false;
    var btn = document.getElementById('lucier-play');
    btn.innerHTML = '&#9654;&#xFE0E; play';
    btn.classList.remove('on');
  }

  /* ── Iterate ── */
  function lucierIterate() {
    if (lucierState.isProcessing || lucierState.iterations.length === 0) return;

    lucierStopPlayback();
    lucierState.isProcessing = true;
    setLucierStatus('processing…');
    document.getElementById('lucier-iterate').disabled = true;

    var currentBuf = lucierState.iterations[lucierState.currentIter];

    applyIteration(currentBuf, lucierState.roomSize, function (err, rendered) {
      if (err) {
        setLucierStatus('error — try again');
        lucierState.isProcessing = false;
        document.getElementById('lucier-iterate').disabled = false;
        return;
      }

      /* If we're not at the latest iteration, trim future iterations */
      lucierState.iterations = lucierState.iterations.slice(0, lucierState.currentIter + 1);
      lucierState.iterations.push(rendered);
      lucierState.currentIter = lucierState.iterations.length - 1;
      lucierState.isProcessing = false;

      document.getElementById('lucier-iterate').disabled = false;
      updateLucierDisplay();
      setLucierStatus('ready');

      /* Auto-play the result */
      lucierPlay();
    });
  }

  /* ── Reset ── */
  function lucierReset() {
    lucierStopPlayback();
    if (lucierState.iterations.length === 0) return;
    lucierState.currentIter = 0;
    updateLucierDisplay();
    setLucierStatus('reset to original');
  }

  /* ── Display ── */
  function updateLucierDisplay() {
    var n    = lucierState.currentIter;
    var total = lucierState.iterations.length;
    var countEl = document.getElementById('lucier-iter-count');
    var subEl   = document.getElementById('lucier-iter-sub');

    countEl.textContent = 'iteration ' + n;
    if (n === 0) {
      subEl.textContent = 'original source · unprocessed';
    } else {
      subEl.textContent = n + ' of ' + (total - 1) + ' · ' + lucierState.roomSize + ' room';
    }
  }

  function setLucierStatus(msg) {
    document.getElementById('lucier-status').textContent = msg;
  }

  /* ── Source: generated voice ── */
  function initGeneratedSource() {
    lucierState.sourceType = 'generated';
    setLucierStatus('generating…');
    document.getElementById('lucier-iterate').disabled = true;

    var ctx = getCtx();

    generateVoiceBuffer(ctx).then(function (buf) {
      lucierState.iterations  = [buf];
      lucierState.currentIter = 0;
      document.getElementById('lucier-iterate').disabled = false;
      updateLucierDisplay();
      setLucierStatus('ready');
      lucierPlay();
    }).catch(function () {
      setLucierStatus('generation failed');
    });
  }

  /* ── Source: microphone recording ── */
  function startMicRecording() {
    if (lucierState.isRecording) {
      stopMicRecording();
      return;
    }

    navigator.mediaDevices.getUserMedia({ audio: true, video: false })
      .then(function (stream) {
        recordedChunks = [];
        mediaRecorder = new MediaRecorder(stream);
        mediaRecorder.ondataavailable = function (e) {
          if (e.data.size > 0) recordedChunks.push(e.data);
        };
        mediaRecorder.onstop = function () {
          stream.getTracks().forEach(function (t) { t.stop(); });
          var blob    = new Blob(recordedChunks, { type: 'audio/webm' });
          var fileReader = new FileReader();
          fileReader.onload = function (ev) {
            var arrayBuf = ev.target.result;
            getCtx().decodeAudioData(arrayBuf, function (decoded) {
              lucierState.iterations  = [decoded];
              lucierState.currentIter = 0;
              document.getElementById('lucier-iterate').disabled = false;
              updateLucierDisplay();
              setLucierStatus('ready');
              lucierPlay();
            }, function () {
              setLucierStatus('decode failed — try again');
            });
          };
          fileReader.readAsArrayBuffer(blob);

          lucierState.isRecording = false;
          var recBtn = document.getElementById('lucier-record');
          recBtn.textContent = '&#9679; record';
          recBtn.classList.remove('on');
        };

        mediaRecorder.start();
        lucierState.isRecording = true;
        var recBtn = document.getElementById('lucier-record');
        recBtn.innerHTML = '&#9632; stop';
        recBtn.classList.add('on');
        setLucierStatus('recording… press stop when done');

        /* Auto-stop after 5 seconds */
        setTimeout(function () {
          if (lucierState.isRecording) stopMicRecording();
        }, 5000);
      })
      .catch(function (err) {
        setLucierStatus('mic access denied — using generated source');
        switchToGenerated();
      });
  }

  function stopMicRecording() {
    if (mediaRecorder && lucierState.isRecording) {
      mediaRecorder.stop();
    }
  }

  function switchToGenerated() {
    lucierState.sourceType = 'generated';
    document.getElementById('src-generated').classList.add('on');
    document.getElementById('src-mic').classList.remove('on');
    document.getElementById('lucier-record').style.display = 'none';
    initGeneratedSource();
  }

  /* ════════════════════════════════
     RADIGUE MODULE
  ════════════════════════════════ */

  var radiqueState = {
    baseFreq:  110,
    detune:    2.5,
    driftRate: 0.07,
    noiseLevel: 0.03,
    numOscs:   3,
    isPlaying: false
  };

  var radiqueOscs       = [];
  var radiqueLFOs       = [];
  var radiqueLFOGains   = [];
  var radiqueNoiseNode  = null;
  var radiqueNoiseGain  = null;
  var radiqueMaster     = null;
  var radiqueDispTimer  = null;

  function startRadigue() {
    stopRadigue();

    var ctx = resumeCtx();

    radiqueMaster = ctx.createGain();
    radiqueMaster.gain.value = 0.4;
    radiqueMaster.connect(ctx.destination);

    var n   = radiqueState.numOscs;
    var base = radiqueState.baseFreq;
    var det  = radiqueState.detune;

    /* Distribute oscillators symmetrically around base */
    var freqs = [];
    if (n === 2) {
      freqs = [base - det / 2, base + det / 2];
    } else {
      freqs = [base - det, base, base + det];
    }

    freqs.forEach(function (freq, i) {
      var osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = freq;

      var oscGain = ctx.createGain();
      oscGain.gain.value = 0.33;
      osc.connect(oscGain);
      oscGain.connect(radiqueMaster);

      /* LFO for slow drift */
      var lfo     = ctx.createOscillator();
      var lfoGain = ctx.createGain();
      lfo.type = 'sine';
      /* Each oscillator gets a slightly different LFO rate and phase */
      lfo.frequency.value = radiqueState.driftRate * (0.7 + i * 0.3);
      lfoGain.gain.value  = det * 0.4; /* drift range = 40% of detune amount */
      lfo.connect(lfoGain);
      lfoGain.connect(osc.frequency);

      osc.start();
      lfo.start();

      radiqueOscs.push(osc);
      radiqueLFOs.push(lfo);
      radiqueLFOGains.push(lfoGain);
    });

    /* Noise floor */
    if (radiqueState.noiseLevel > 0) {
      var noiseBuf = makePinkNoise(ctx);
      radiqueNoiseNode = ctx.createBufferSource();
      radiqueNoiseNode.buffer = noiseBuf;
      radiqueNoiseNode.loop   = true;
      radiqueNoiseGain = ctx.createGain();
      radiqueNoiseGain.gain.value = radiqueState.noiseLevel;
      radiqueNoiseNode.connect(radiqueNoiseGain);
      radiqueNoiseGain.connect(radiqueMaster);
      radiqueNoiseNode.start();
    }

    radiqueState.isPlaying = true;
    document.getElementById('radigue-play').innerHTML = '&#9632;&#xFE0E; stop';
    document.getElementById('radigue-play').classList.add('on');

    /* Update frequency display every 200ms */
    radiqueDispTimer = setInterval(updateRadiqueDisplay, 200);
    updateRadiqueDisplay();
  }

  function stopRadigue() {
    radiqueOscs.forEach(function (o) { try { o.stop(); } catch(e) {} });
    radiqueLFOs.forEach(function (l) { try { l.stop(); } catch(e) {} });
    if (radiqueNoiseNode) { try { radiqueNoiseNode.stop(); } catch(e) {} }
    radiqueOscs = []; radiqueLFOs = []; radiqueLFOGains = [];
    radiqueNoiseNode = null; radiqueNoiseGain = null; radiqueMaster = null;
    if (radiqueDispTimer) { clearInterval(radiqueDispTimer); radiqueDispTimer = null; }

    radiqueState.isPlaying = false;
    document.getElementById('radigue-play').innerHTML = '&#9654;&#xFE0E; play';
    document.getElementById('radigue-play').classList.remove('on');
  }

  function updateRadiqueDisplay() {
    var ctx = getCtx();
    var ids = ['r-f1','r-f2','r-f3'];
    radiqueOscs.forEach(function (osc, i) {
      if (ids[i]) {
        var el = document.getElementById(ids[i]);
        if (el) el.textContent = osc.frequency.value.toFixed(1) + ' Hz';
      }
    });
    /* If fewer than 3 oscillators, blank the extra */
    if (radiqueOscs.length < 3) {
      var el = document.getElementById('r-f3');
      if (el) el.textContent = '—';
    }
  }

  function makePinkNoise(ctx) {
    var sr = ctx.sampleRate, len = sr * 4;
    var buf = ctx.createBuffer(1, len, sr);
    var d = buf.getChannelData(0);
    var b0=0,b1=0,b2=0,b3=0,b4=0,b5=0,b6=0;
    for (var i = 0; i < len; i++) {
      var w = Math.random() * 2 - 1;
      b0=0.99886*b0+w*0.0555179; b1=0.99332*b1+w*0.0750759;
      b2=0.96900*b2+w*0.1538520; b3=0.86650*b3+w*0.3104856;
      b4=0.55000*b4+w*0.5329522; b5=-0.7616*b5-w*0.0168980;
      d[i]=(b0+b1+b2+b3+b4+b5+b6+w*0.5362)*0.11;
      b6=w*0.115926;
    }
    return buf;
  }

  /* ── Radigue slider updates ── */
  function updateRadiqueParams() {
    /* If playing, stop and restart to apply changes */
    if (radiqueState.isPlaying) {
      stopRadigue();
      startRadigue();
    }
  }

  function noiseLabel(val) {
    if (val < 0.01)  return 'off';
    if (val < 0.04)  return 'low';
    if (val < 0.08)  return 'medium';
    return 'high';
  }

  /* ════════════════════════════════
     INIT
  ════════════════════════════════ */
  function init() {

    /* --- Lucier controls --- */

    document.getElementById('src-generated').addEventListener('click', function () {
      document.getElementById('src-generated').classList.add('on');
      document.getElementById('src-mic').classList.remove('on');
      document.getElementById('lucier-record').style.display = 'none';
      lucierState.sourceType = 'generated';
      initGeneratedSource();
    });

    document.getElementById('src-mic').addEventListener('click', function () {
      document.getElementById('src-mic').classList.add('on');
      document.getElementById('src-generated').classList.remove('on');
      document.getElementById('lucier-record').style.display = 'inline-block';
      lucierState.sourceType = 'mic';
      /* Reset and wait for recording */
      lucierStopPlayback();
      lucierState.iterations = [];
      lucierState.currentIter = 0;
      updateLucierDisplay();
      setLucierStatus('press record and speak, then press stop');
      document.getElementById('lucier-iterate').disabled = true;
    });

    document.getElementById('lucier-record').addEventListener('click', startMicRecording);

    document.querySelectorAll('[data-room]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        lucierState.roomSize = btn.getAttribute('data-room');
        document.querySelectorAll('[data-room]').forEach(function (b) {
          b.classList.toggle('on', b === btn);
        });
      });
    });

    document.getElementById('lucier-play').addEventListener('click', function () {
      if (lucierState.isPlaying) {
        lucierStopPlayback();
      } else {
        lucierPlay();
      }
    });

    document.getElementById('lucier-iterate').addEventListener('click', lucierIterate);
    document.getElementById('lucier-reset').addEventListener('click', lucierReset);

    /* --- Radigue controls --- */

    document.getElementById('r-base').addEventListener('input', function (e) {
      radiqueState.baseFreq = parseInt(e.target.value, 10);
      document.getElementById('r-base-val').textContent = radiqueState.baseFreq + ' Hz';
      updateRadiqueParams();
    });

    document.getElementById('r-detune').addEventListener('input', function (e) {
      radiqueState.detune = parseFloat(e.target.value);
      document.getElementById('r-detune-val').textContent = radiqueState.detune + ' Hz';
      updateRadiqueParams();
    });

    document.getElementById('r-drift').addEventListener('input', function (e) {
      radiqueState.driftRate = parseFloat(e.target.value);
      document.getElementById('r-drift-val').textContent = radiqueState.driftRate.toFixed(2) + ' Hz';
      updateRadiqueParams();
    });

    document.getElementById('r-noise').addEventListener('input', function (e) {
      radiqueState.noiseLevel = parseFloat(e.target.value);
      document.getElementById('r-noise-val').textContent = noiseLabel(radiqueState.noiseLevel);
      updateRadiqueParams();
    });

    document.querySelectorAll('[data-oscs]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        radiqueState.numOscs = parseInt(btn.getAttribute('data-oscs'), 10);
        document.querySelectorAll('[data-oscs]').forEach(function (b) {
          b.classList.toggle('on', b === btn);
        });
        updateRadiqueParams();
      });
    });

    document.getElementById('radigue-play').addEventListener('click', function () {
      if (radiqueState.isPlaying) { stopRadigue(); } else { startRadigue(); }
    });

    /* --- Init Lucier with generated source --- */
    initGeneratedSource();
  }

  init();

}());
