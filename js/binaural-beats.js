(function () {
  'use strict';

  /* ── Presets ── */
  var PRESETS = {
    sleep:   { carrier: 200, beat: 2,  ambient: 'brown', ambientVol: 0.4, label: 'delta',  desc: 'deep sleep · restorative · 0.5–4 Hz' },
    calm:    { carrier: 220, beat: 6,  ambient: 'pink',  ambientVol: 0.35, label: 'theta', desc: 'drowsy · meditative · 4–8 Hz' },
    focus:   { carrier: 200, beat: 10, ambient: 'none',  ambientVol: 0.3, label: 'alpha',  desc: 'relaxed wakefulness · eyes closed · 8–13 Hz' },
    energise:{ carrier: 220, beat: 20, ambient: 'none',  ambientVol: 0.2, label: 'beta',   desc: 'alert · focused · active thinking · 13–30 Hz' },
    custom:  null
  };

  /* ── EEG band lookup ── */
  function getBand(hz) {
    if (hz < 4)  return { name: 'delta',  desc: 'deep sleep · restorative · 0.5–4 Hz' };
    if (hz < 8)  return { name: 'theta',  desc: 'drowsy · meditative · 4–8 Hz' };
    if (hz < 13) return { name: 'alpha',  desc: 'relaxed wakefulness · eyes closed · 8–13 Hz' };
    if (hz < 30) return { name: 'beta',   desc: 'alert · focused · active thinking · 13–30 Hz' };
    return       { name: 'gamma',         desc: 'high-level processing · binding · 30+ Hz' };
  }

  /* ── State ── */
  var state = {
    carrier:    200,
    beat:       10,
    vol:        0.5,
    ambientVol: 0.3,
    ambient:    'none',
    timerMins:  0
  };

  /* ── Audio nodes ── */
  var audioCtx     = null;
  var leftOsc      = null;
  var rightOsc     = null;
  var leftGain     = null;
  var rightGain    = null;
  var masterGain   = null;
  var merger       = null;
  var ambientSrc   = null;
  var ambientGain  = null;
  var analyser     = null;

  var playing      = false;
  var timerInterval = null;
  var timerRemaining = 0;
  var scopeRunning = false;

  /* ── Init audio context ── */
  function initAudio() {
    if (audioCtx) return;
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 2048;

    masterGain = audioCtx.createGain();
    masterGain.gain.value = state.vol;
    masterGain.connect(analyser);
    analyser.connect(audioCtx.destination);

    ambientGain = audioCtx.createGain();
    ambientGain.gain.value = 0;
    ambientGain.connect(audioCtx.destination);

    startScope();
  }

  /* ── Noise generators ── */
  function makePinkNoise() {
    var sr = audioCtx.sampleRate;
    var len = sr * 4;
    var buf = audioCtx.createBuffer(1, len, sr);
    var d = buf.getChannelData(0);
    var b0=0,b1=0,b2=0,b3=0,b4=0,b5=0,b6=0;
    for (var i = 0; i < len; i++) {
      var w = Math.random() * 2 - 1;
      b0 = 0.99886*b0 + w*0.0555179;
      b1 = 0.99332*b1 + w*0.0750759;
      b2 = 0.96900*b2 + w*0.1538520;
      b3 = 0.86650*b3 + w*0.3104856;
      b4 = 0.55000*b4 + w*0.5329522;
      b5 = -0.7616*b5 - w*0.0168980;
      d[i] = (b0+b1+b2+b3+b4+b5+b6+w*0.5362) * 0.11;
      b6 = w * 0.115926;
    }
    return buf;
  }

  function makeBrownNoise() {
    var sr = audioCtx.sampleRate;
    var len = sr * 4;
    var buf = audioCtx.createBuffer(1, len, sr);
    var d = buf.getChannelData(0);
    var last = 0;
    for (var i = 0; i < len; i++) {
      var w = Math.random() * 2 - 1;
      last = (last + 0.02 * w) / 1.02;
      d[i] = last * 3.5;
    }
    return buf;
  }

  /* ── Start/stop ambient ── */
  function startAmbient() {
    stopAmbient();
    if (state.ambient === 'none') {
      ambientGain.gain.setValueAtTime(0, audioCtx.currentTime);
      return;
    }
    var buf = state.ambient === 'pink' ? makePinkNoise() : makeBrownNoise();
    ambientSrc = audioCtx.createBufferSource();
    ambientSrc.buffer = buf;
    ambientSrc.loop = true;
    ambientSrc.connect(ambientGain);
    ambientSrc.start();
    ambientGain.gain.setValueAtTime(state.ambientVol, audioCtx.currentTime);
  }

  function stopAmbient() {
    if (ambientSrc) {
      try { ambientSrc.stop(); } catch(e) {}
      ambientSrc = null;
    }
    if (ambientGain) ambientGain.gain.setValueAtTime(0, audioCtx.currentTime);
  }

  /* ── Start binaural tones ── */
  function startTones() {
    stopTones();

    merger = audioCtx.createChannelMerger(2);
    merger.connect(masterGain);

    leftGain  = audioCtx.createGain(); leftGain.gain.value  = 1;
    rightGain = audioCtx.createGain(); rightGain.gain.value = 1;

    leftOsc  = audioCtx.createOscillator();
    rightOsc = audioCtx.createOscillator();

    leftOsc.type  = 'sine';
    rightOsc.type = 'sine';
    leftOsc.frequency.value  = state.carrier;
    rightOsc.frequency.value = state.carrier + state.beat;

    leftOsc.connect(leftGain);
    rightOsc.connect(rightGain);
    leftGain.connect(merger, 0, 0);
    rightGain.connect(merger, 0, 1);

    var now = audioCtx.currentTime;
    masterGain.gain.setValueAtTime(0, now);
    masterGain.gain.linearRampToValueAtTime(state.vol, now + 0.05);

    leftOsc.start();
    rightOsc.start();
  }

  function stopTones() {
    if (leftOsc)  { try { leftOsc.stop();  } catch(e) {} leftOsc  = null; }
    if (rightOsc) { try { rightOsc.stop(); } catch(e) {} rightOsc = null; }
    if (merger)   { merger.disconnect(); merger = null; }
  }

  /* ── Play / stop ── */
  function togglePlay() {
    initAudio();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    var btn = document.getElementById('btn-play');
    if (!playing) {
      playing = true;
      startTones();
      startAmbient();
      if (state.timerMins > 0) startTimer();
      btn.textContent = '&#9632;\uFE0E stop';
      btn.innerHTML   = '&#9632;&#xFE0E; stop';
      btn.classList.add('on');
    } else {
      stopAll();
    }
  }

  function stopAll() {
    playing = false;
    stopTones();
    stopAmbient();
    clearTimer();
    var btn = document.getElementById('btn-play');
    btn.innerHTML = '&#9654;&#xFE0E; play';
    btn.classList.remove('on');
    document.getElementById('timer-display').textContent = '';
  }

  /* ── Oscillator frequency update ── */
  function updateFrequencies() {
    if (leftOsc  && playing) leftOsc.frequency.setValueAtTime(state.carrier, audioCtx.currentTime);
    if (rightOsc && playing) rightOsc.frequency.setValueAtTime(state.carrier + state.beat, audioCtx.currentTime);
    updateDisplays();
  }

  /* ── Displays ── */
  function updateDisplays() {
    var band = getBand(state.beat);
    document.getElementById('disp-left').textContent  = state.carrier + ' Hz';
    document.getElementById('disp-right').textContent = (state.carrier + state.beat) + ' Hz';
    document.getElementById('disp-beat').textContent  = state.beat + ' Hz';
    document.getElementById('disp-band').textContent  = band.name;
    document.getElementById('disp-band-desc').textContent = band.desc;
  }

  /* ── Timer ── */
  function startTimer() {
    clearTimer();
    timerRemaining = state.timerMins * 60;
    updateTimerDisplay();
    timerInterval = setInterval(function () {
      timerRemaining--;
      updateTimerDisplay();
      if (timerRemaining <= 0) stopAll();
    }, 1000);
  }

  function clearTimer() {
    if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
    timerRemaining = 0;
    document.getElementById('timer-display').textContent = '';
  }

  function updateTimerDisplay() {
    if (timerRemaining <= 0) return;
    var m = Math.floor(timerRemaining / 60);
    var s = timerRemaining % 60;
    document.getElementById('timer-display').textContent =
      m + ':' + (s < 10 ? '0' : '') + s;
  }

  /* ── Presets ── */
  function applyPreset(name) {
    var p = PRESETS[name];
    if (!p) return;
    state.carrier    = p.carrier;
    state.beat       = p.beat;
    state.ambientVol = p.ambientVol;
    state.ambient    = p.ambient;

    document.getElementById('carrier').value   = p.carrier;
    document.getElementById('beat-freq').value = p.beat;
    document.getElementById('ambient-vol').value = p.ambientVol;
    document.getElementById('carrier-val').textContent   = p.carrier + ' Hz';
    document.getElementById('beat-val').textContent      = p.beat + ' Hz';
    document.getElementById('ambient-vol-val').textContent = Math.round(p.ambientVol * 100) + '%';

    setAmbient(p.ambient);
    updateFrequencies();

    document.querySelectorAll('[data-p]').forEach(function (b) {
      b.classList.toggle('on', b.getAttribute('data-p') === name);
    });
  }

  function setAmbient(type) {
    state.ambient = type;
    if (playing) startAmbient();
    document.querySelectorAll('[data-ambient]').forEach(function (b) {
      b.classList.toggle('on', b.getAttribute('data-ambient') === type);
    });
  }

  function clearPresetSelection() {
    document.querySelectorAll('[data-p]').forEach(function (b) {
      b.classList.remove('on');
    });
    document.querySelector('[data-p="custom"]').classList.add('on');
  }

  /* ── Oscilloscope ── */
  function startScope() {
    if (scopeRunning) return;
    scopeRunning = true;
    var canvas = document.getElementById('bb-canvas');
    if (!canvas) return;
    var ctx2 = canvas.getContext('2d');
    var buf  = new Float32Array(analyser.fftSize);

    function drawGrid(W, H) {
      ctx2.strokeStyle = 'rgba(32,38,157,0.08)';
      ctx2.lineWidth   = 0.5;
      for (var x = 0; x <= 8; x++) {
        ctx2.beginPath();
        ctx2.moveTo((x/8)*W, 0); ctx2.lineTo((x/8)*W, H); ctx2.stroke();
      }
      for (var y = 0; y <= 4; y++) {
        ctx2.beginPath();
        ctx2.moveTo(0, (y/4)*H); ctx2.lineTo(W, (y/4)*H); ctx2.stroke();
      }
    }

    function draw() {
      requestAnimationFrame(draw);
      var dpr = window.devicePixelRatio || 1;
      var W   = canvas.offsetWidth  * dpr;
      var H   = canvas.offsetHeight * dpr;
      if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
      ctx2.clearRect(0, 0, W, H);
      drawGrid(W, H);
      analyser.getFloatTimeDomainData(buf);
      ctx2.beginPath();
      for (var i = 0; i < buf.length; i++) {
        var x = (i / buf.length) * W;
        var y = ((1 - buf[i]) / 2) * H;
        if (i === 0) { ctx2.moveTo(x, y); } else { ctx2.lineTo(x, y); }
      }
      ctx2.strokeStyle = playing ? '#20269D' : 'rgba(32,38,157,0.2)';
      ctx2.lineWidth   = 1.5 * dpr;
      ctx2.stroke();
    }
    draw();
  }

  /* Static scope before AudioContext */
  function startStaticScope() {
    var canvas = document.getElementById('bb-canvas');
    if (!canvas) return;
    var ctx2 = canvas.getContext('2d');
    function draw() {
      if (scopeRunning) return;
      requestAnimationFrame(draw);
      var dpr = window.devicePixelRatio || 1;
      var W   = canvas.offsetWidth  * dpr;
      var H   = canvas.offsetHeight * dpr;
      if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
      ctx2.clearRect(0, 0, W, H);
      ctx2.strokeStyle = 'rgba(32,38,157,0.08)';
      ctx2.lineWidth = 0.5;
      for (var x = 0; x <= 8; x++) {
        ctx2.beginPath();
        ctx2.moveTo((x/8)*W, 0); ctx2.lineTo((x/8)*W, H); ctx2.stroke();
      }
      for (var y = 0; y <= 4; y++) {
        ctx2.beginPath();
        ctx2.moveTo(0, (y/4)*H); ctx2.lineTo(W, (y/4)*H); ctx2.stroke();
      }
      ctx2.beginPath(); ctx2.moveTo(0, H/2); ctx2.lineTo(W, H/2);
      ctx2.strokeStyle = 'rgba(32,38,157,0.2)';
      ctx2.lineWidth = 1.5 * dpr; ctx2.stroke();
    }
    draw();
  }

  /* ── Wire up controls ── */
  function init() {
    document.getElementById('btn-play').addEventListener('click', togglePlay);

    document.getElementById('carrier').addEventListener('input', function (e) {
      state.carrier = parseInt(e.target.value, 10);
      document.getElementById('carrier-val').textContent = state.carrier + ' Hz';
      updateFrequencies();
      clearPresetSelection();
    });

    document.getElementById('beat-freq').addEventListener('input', function (e) {
      state.beat = parseFloat(e.target.value);
      document.getElementById('beat-val').textContent = state.beat + ' Hz';
      updateFrequencies();
      clearPresetSelection();
    });

    document.getElementById('vol').addEventListener('input', function (e) {
      state.vol = parseFloat(e.target.value);
      document.getElementById('vol-val').textContent = Math.round(state.vol * 100) + '%';
      if (masterGain) masterGain.gain.setValueAtTime(state.vol, audioCtx.currentTime);
    });

    document.getElementById('ambient-vol').addEventListener('input', function (e) {
      state.ambientVol = parseFloat(e.target.value);
      document.getElementById('ambient-vol-val').textContent = Math.round(state.ambientVol * 100) + '%';
      if (ambientGain) ambientGain.gain.setValueAtTime(state.ambientVol, audioCtx.currentTime);
    });

    /* Ambient buttons */
    document.querySelectorAll('[data-ambient]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        setAmbient(btn.getAttribute('data-ambient'));
        clearPresetSelection();
      });
    });

    /* Timer buttons */
    document.querySelectorAll('[data-mins]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        state.timerMins = parseInt(btn.getAttribute('data-mins'), 10);
        document.querySelectorAll('[data-mins]').forEach(function (b) {
          b.classList.toggle('on', b === btn);
        });
        if (playing && state.timerMins > 0) {
          startTimer();
        } else if (state.timerMins === 0) {
          clearTimer();
        }
      });
    });

    /* Session preset buttons */
    document.querySelectorAll('[data-p]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var name = btn.getAttribute('data-p');
        if (name !== 'custom') applyPreset(name);
      });
    });

    /* Apply default preset on load */
    applyPreset('focus');
    startStaticScope();
  }

  init();

}());
