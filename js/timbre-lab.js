(function () {
  'use strict';

  /* ── Preset definitions ── */
  var PRESETS = {
    sine:   { ratios: [1, 2, 3, 4, 5, 6],         gains: [0.8, 0,    0,    0,    0,    0   ] },
    flute:  { ratios: [1, 2, 3, 4, 5, 6],         gains: [0.8, 0.4,  0.2,  0.08, 0.03, 0   ] },
    string: { ratios: [1, 2, 3, 4, 5, 6],         gains: [0.7, 0.5,  0.35, 0.25, 0.15, 0.08] },
    brass:  { ratios: [1, 2, 3, 4, 5, 6],         gains: [0.6, 0.55, 0.45, 0.35, 0.25, 0.15] },
    voice:  { ratios: [1, 2, 3, 4, 5, 6],         gains: [0.8, 0.5,  0.35, 0.15, 0.08, 0   ] },
    hollow: { ratios: [1, 2, 3, 4, 5, 6],         gains: [0.7, 0,    0.35, 0,    0.2,  0   ] },
    bell:   { ratios: [1, 2.7, 5.8, 8.9, 1,   1], gains: [0.6, 0.4,  0.3,  0.2,  0,    0   ] }
  };

  var NUM = 6;

  /* ── Audio state ── */
  var audioCtx    = null;
  var analyser    = null;
  var masterGain  = null;
  var pinkSrc     = null;
  var pinkGain    = null;
  var oscs        = [];
  var gainNodes   = [];
  var playing     = false;
  var noiseOn     = false;
  var scopeRunning = false;
  var releaseTimer = null;

  /* ── Synth state ── */
  var state = {
    fundamental: 110,
    attack: 30,
    release: 300,
    ratios: [1, 2, 3, 4, 5, 6],
    gains:  [0.8, 0.4, 0.25, 0.15, 0.08, 0.05],
    muted:  [false, false, false, false, false, false]
  };

  function effGain(i) {
    return state.muted[i] ? 0 : state.gains[i];
  }

  /* ── AudioContext init ── */
  function initAudio() {
    if (audioCtx) return;
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 2048;
    masterGain = audioCtx.createGain();
    masterGain.gain.value = 0;
    masterGain.connect(analyser);
    analyser.connect(audioCtx.destination);

    /* Pink noise */
    var pinkBuf = makePinkNoise(audioCtx);
    pinkSrc = audioCtx.createBufferSource();
    pinkSrc.buffer = pinkBuf;
    pinkSrc.loop = true;
    pinkGain = audioCtx.createGain();
    pinkGain.gain.value = 0;
    pinkSrc.connect(pinkGain);
    pinkGain.connect(analyser);
    pinkSrc.start();

    startScope();
  }

  /* Paul Kellet's pink noise algorithm */
  function makePinkNoise(actx) {
    var sr = actx.sampleRate;
    var len = sr * 3;
    var buf = actx.createBuffer(1, len, sr);
    var d = buf.getChannelData(0);
    var b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (var i = 0; i < len; i++) {
      var w = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + w * 0.0555179;
      b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.96900 * b2 + w * 0.1538520;
      b3 = 0.86650 * b3 + w * 0.3104856;
      b4 = 0.55000 * b4 + w * 0.5329522;
      b5 = -0.7616 * b5 - w * 0.0168980;
      d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.1;
      b6 = w * 0.115926;
    }
    return buf;
  }

  /* ── Oscillators ── */
  function startOscs() {
    stopOscsNow();
    for (var i = 0; i < NUM; i++) {
      var osc = audioCtx.createOscillator();
      var gn  = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.value = state.fundamental * state.ratios[i];
      gn.gain.value = effGain(i);
      osc.connect(gn);
      gn.connect(masterGain);
      osc.start();
      oscs.push(osc);
      gainNodes.push(gn);
    }
    var now  = audioCtx.currentTime;
    var atkS = state.attack / 1000;
    masterGain.gain.cancelScheduledValues(now);
    masterGain.gain.setValueAtTime(0, now);
    masterGain.gain.linearRampToValueAtTime(0.45, now + Math.max(atkS, 0.001));
  }

  function stopOscsNow() {
    if (releaseTimer) { clearTimeout(releaseTimer); releaseTimer = null; }
    for (var i = 0; i < oscs.length; i++) {
      try { oscs[i].stop(); } catch (e) {}
    }
    oscs = [];
    gainNodes = [];
  }

  function stopOscsWithRelease() {
    if (releaseTimer) { clearTimeout(releaseTimer); releaseTimer = null; }
    var now  = audioCtx.currentTime;
    var relS = state.release / 1000;
    masterGain.gain.cancelScheduledValues(now);
    masterGain.gain.setValueAtTime(masterGain.gain.value, now);
    masterGain.gain.linearRampToValueAtTime(0, now + Math.max(relS, 0.001));
    var snapOscs  = oscs.slice();
    var snapGains = gainNodes.slice();
    releaseTimer = setTimeout(function () {
      for (var i = 0; i < snapOscs.length; i++) {
        try { snapOscs[i].stop(); } catch (e) {}
      }
      if (oscs === snapOscs || oscs.length === 0) { oscs = []; gainNodes = []; }
      releaseTimer = null;
    }, state.release + 80);
  }

  /* ── Play / stop ── */
  function togglePlay() {
    initAudio();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    var btn = document.getElementById('btn-play');
    if (!playing) {
      playing = true;
      startOscs();
      btn.textContent = '■ stop';
      btn.classList.add('on');
    } else {
      playing = false;
      stopOscsWithRelease();
      btn.textContent = '▶ play';
      btn.classList.remove('on');
    }
  }

  /* ── Pink noise toggle ── */
  function toggleNoise() {
    initAudio();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    noiseOn = !noiseOn;
    var now = audioCtx.currentTime;
    pinkGain.gain.cancelScheduledValues(now);
    pinkGain.gain.setValueAtTime(pinkGain.gain.value, now);
    pinkGain.gain.linearRampToValueAtTime(noiseOn ? 0.22 : 0, now + 0.08);
    var btn = document.getElementById('btn-noise');
    btn.classList.toggle('on', noiseOn);
    btn.classList.toggle('noise-on', noiseOn);
  }

  /* ── Fundamental ── */
  function setFundamental(v) {
    state.fundamental = parseInt(v, 10);
    document.getElementById('fund-val').textContent = v + ' Hz';
    if (playing) {
      for (var i = 0; i < oscs.length; i++) {
        oscs[i].frequency.value = state.fundamental * state.ratios[i];
      }
    }
    var freqEls = document.querySelectorAll('.hcard-f');
    for (var j = 0; j < freqEls.length; j++) {
      freqEls[j].textContent = Math.round(state.fundamental * state.ratios[j]) + ' Hz';
    }
  }

  /* ── Presets ── */
  function applyPreset(name) {
    var p = PRESETS[name];
    if (!p) return;
    state.ratios = p.ratios.slice();
    state.gains  = p.gains.slice();
    state.muted  = [false, false, false, false, false, false];
    if (playing) {
      for (var i = 0; i < oscs.length; i++) {
        oscs[i].frequency.value = state.fundamental * state.ratios[i];
        gainNodes[i].gain.value = effGain(i);
      }
    }
    renderCards();
    var btns = document.querySelectorAll('.lab-preset-btn');
    for (var j = 0; j < btns.length; j++) {
      btns[j].classList.toggle('on', btns[j].getAttribute('data-p') === name);
    }
  }

  /* ── Render harmonic cards ── */
  function renderCards() {
    var grid = document.getElementById('harmonics');
    if (!grid) return;
    grid.innerHTML = '';

    for (var i = 0; i < NUM; i++) {
      var isInt    = Number.isInteger(state.ratios[i]);
      var ratioTxt = isInt ? state.ratios[i] + ':1' : state.ratios[i].toFixed(1) + '×';
      var freq     = Math.round(state.fundamental * state.ratios[i]);
      var g        = state.gains[i];
      var muted    = state.muted[i];

      var card = document.createElement('div');
      card.className = 'lab-hcard' + (muted ? ' muted' : '');
      card.innerHTML =
        '<div class="hcard-n">H' + (i + 1) + '</div>' +
        '<div class="hcard-r">' + ratioTxt + '</div>' +
        '<div class="hcard-f">' + freq + '&nbsp;Hz</div>' +
        '<input type="range" min="0" max="1" step="0.01" value="' + g.toFixed(2) + '">' +
        '<div class="hcard-g">' + g.toFixed(2) + '</div>' +
        '<div class="hcard-mute-tag">muted</div>';

      /* Closure to capture index */
      (function (idx, el) {
        /* Click card = toggle mute */
        el.addEventListener('click', function (e) {
          if (e.target.tagName === 'INPUT') return;
          state.muted[idx] = !state.muted[idx];
          if (playing && gainNodes[idx]) {
            gainNodes[idx].gain.value = effGain(idx);
          }
          el.classList.toggle('muted', state.muted[idx]);
          clearPresetSelection();
        });

        /* Slider = adjust gain only, no visual card change */
        el.querySelector('input').addEventListener('input', function (e) {
          e.stopPropagation();
          state.gains[idx] = parseFloat(e.target.value);
          if (playing && gainNodes[idx]) {
            gainNodes[idx].gain.value = effGain(idx);
          }
          el.querySelector('.hcard-g').textContent = state.gains[idx].toFixed(2);
          clearPresetSelection();
        });
      }(i, card));

      grid.appendChild(card);
    }
  }

  function clearPresetSelection() {
    var btns = document.querySelectorAll('.lab-preset-btn');
    for (var i = 0; i < btns.length; i++) {
      btns[i].classList.remove('on');
    }
  }

  /* ── Oscilloscope ── */
  function startScope() {
    if (scopeRunning) return;
    scopeRunning = true;

    var canvas = document.getElementById('scope');
    if (!canvas) return;
    var ctx2 = canvas.getContext('2d');
    var buf  = new Float32Array(analyser.fftSize);

    /* Resolved CSS color values */
    var textColor   = '#20269D';  /* --text */
    var accentColor = '#6A1E78';  /* --accent */

    function drawGrid(W, H) {
      ctx2.strokeStyle = 'rgba(32, 38, 157, 0.08)';
      ctx2.lineWidth = 0.5;
      var cols = 8;
      var rows = 4;
      for (var x = 0; x <= cols; x++) {
        ctx2.beginPath();
        ctx2.moveTo((x / cols) * W, 0);
        ctx2.lineTo((x / cols) * W, H);
        ctx2.stroke();
      }
      for (var y = 0; y <= rows; y++) {
        ctx2.beginPath();
        ctx2.moveTo(0, (y / rows) * H);
        ctx2.lineTo(W, (y / rows) * H);
        ctx2.stroke();
      }
    }

    function draw() {
      requestAnimationFrame(draw);
      var dpr = window.devicePixelRatio || 1;
      var W   = canvas.offsetWidth  * dpr;
      var H   = canvas.offsetHeight * dpr;
      if (canvas.width !== W || canvas.height !== H) {
        canvas.width  = W;
        canvas.height = H;
      }
      ctx2.clearRect(0, 0, W, H);
      drawGrid(W, H);

      analyser.getFloatTimeDomainData(buf);
      var active = playing || noiseOn;

      ctx2.beginPath();
      for (var i = 0; i < buf.length; i++) {
        var x = (i / buf.length) * W;
        var y = ((1 - buf[i]) / 2) * H;
        if (i === 0) { ctx2.moveTo(x, y); } else { ctx2.lineTo(x, y); }
      }
      ctx2.strokeStyle = active ? accentColor : 'rgba(32, 38, 157, 0.2)';
      ctx2.lineWidth   = 1.5 * dpr;
      ctx2.stroke();
    }
    draw();
  }

  /* Static scope before AudioContext exists */
  function startStaticScope() {
    var canvas = document.getElementById('scope');
    if (!canvas) return;
    var ctx2 = canvas.getContext('2d');

    function draw() {
      if (scopeRunning) return;
      requestAnimationFrame(draw);
      var dpr = window.devicePixelRatio || 1;
      var W   = canvas.offsetWidth  * dpr;
      var H   = canvas.offsetHeight * dpr;
      if (canvas.width !== W || canvas.height !== H) {
        canvas.width  = W;
        canvas.height = H;
      }
      ctx2.clearRect(0, 0, W, H);
      /* Grid */
      ctx2.strokeStyle = 'rgba(32, 38, 157, 0.08)';
      ctx2.lineWidth = 0.5;
      for (var x = 0; x <= 8; x++) {
        ctx2.beginPath();
        ctx2.moveTo((x / 8) * W, 0);
        ctx2.lineTo((x / 8) * W, H);
        ctx2.stroke();
      }
      for (var y = 0; y <= 4; y++) {
        ctx2.beginPath();
        ctx2.moveTo(0, (y / 4) * H);
        ctx2.lineTo(W, (y / 4) * H);
        ctx2.stroke();
      }
      /* Flat line */
      ctx2.beginPath();
      ctx2.moveTo(0, H / 2);
      ctx2.lineTo(W, H / 2);
      ctx2.strokeStyle = 'rgba(32, 38, 157, 0.2)';
      ctx2.lineWidth = 1.5 * dpr;
      ctx2.stroke();
    }
    draw();
  }

  /* ── Wire up controls ── */
  function init() {
    var btnPlay = document.getElementById('btn-play');
    var btnNoise = document.getElementById('btn-noise');
    var fundSlider = document.getElementById('fund');
    var atkSlider  = document.getElementById('atk');
    var relSlider  = document.getElementById('rel');

    if (btnPlay)  btnPlay.addEventListener('click', togglePlay);
    if (btnNoise) btnNoise.addEventListener('click', toggleNoise);

    if (fundSlider) {
      fundSlider.addEventListener('input', function (e) {
        setFundamental(e.target.value);
      });
    }

    if (atkSlider) {
      atkSlider.addEventListener('input', function (e) {
        state.attack = parseInt(e.target.value, 10);
        var v = state.attack;
        document.getElementById('atk-val').textContent =
          v >= 1000 ? (v / 1000).toFixed(1) + ' s' : v + ' ms';
      });
    }

    if (relSlider) {
      relSlider.addEventListener('input', function (e) {
        state.release = parseInt(e.target.value, 10);
        var v = state.release;
        document.getElementById('rel-val').textContent =
          v >= 1000 ? (v / 1000).toFixed(1) + ' s' : v + ' ms';
      });
    }

    var presetBtns = document.querySelectorAll('.lab-preset-btn');
    for (var i = 0; i < presetBtns.length; i++) {
      (function (btn) {
        btn.addEventListener('click', function () {
          applyPreset(btn.getAttribute('data-p'));
        });
      }(presetBtns[i]));
    }

    renderCards();
    startStaticScope();
  }

  /* Run after DOM is ready (script is deferred so DOM is always ready) */
  init();

}());
