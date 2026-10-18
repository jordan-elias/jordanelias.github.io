/* phase-machine.js — phase machine with melodic sequencer and crop editor
   Core playback engine based on original implementation.
   Melodic sequencer mode added.
   Crop editor (upload + microphone only) added: pick or record a clip,
   drag the handles to choose a region, set an optional loop crossfade,
   then press "load tape" to send the selection to the phase machine.
*/
(function () {
  'use strict';

  /* ════════════════════════════════════════════════════════════
     CONSTANTS
  ════════════════════════════════════════════════════════════ */
  var MAX_REC_SEC    = 60;     /* microphone recording cap (with countdown) */
  var MAX_UPLOAD_SEC = 120;    /* uploads are trimmed to their first N seconds */
  var MIN_CROP_SEC   = 0.25;   /* shortest selectable crop */
  var MAX_XFADE_FRAC = 0.4;    /* crossfade never exceeds 40% of the crop length */

  /* ════════════════════════════════════════════════════════════
     MUSIC THEORY
     Explicit scale tables — every key spelled correctly.
     Sharp keys: C G D A E B F# C#
     Flat keys:  F Bb Eb Ab Db Gb
  ════════════════════════════════════════════════════════════ */

  var MAJOR_SCALES = {
    'C' : ['C','D','E','F','G','A','B'],
    'G' : ['G','A','B','C','D','E','F#'],
    'D' : ['D','E','F#','G','A','B','C#'],
    'A' : ['A','B','C#','D','E','F#','G#'],
    'E' : ['E','F#','G#','A','B','C#','D#'],
    'B' : ['B','C#','D#','E','F#','G#','A#'],
    'F#': ['F#','G#','A#','B','C#','D#','E#'],
    'C#': ['C#','D#','E#','F#','G#','A#','B#'],
    'F' : ['F','G','A','Bb','C','D','E'],
    'Bb': ['Bb','C','D','Eb','F','G','A'],
    'Eb': ['Eb','F','G','Ab','Bb','C','D'],
    'Ab': ['Ab','Bb','C','Db','Eb','F','G'],
    'Db': ['Db','Eb','F','Gb','Ab','Bb','C'],
    'Gb': ['Gb','Ab','Bb','Cb','Db','Eb','F'],
  };

  var MINOR_SCALES = {
    'C' : ['C','D','Eb','F','G','Ab','Bb'],
    'G' : ['G','A','Bb','C','D','Eb','F'],
    'D' : ['D','E','F','G','A','Bb','C'],
    'A' : ['A','B','C','D','E','F','G'],
    'E' : ['E','F#','G','A','B','C','D'],
    'B' : ['B','C#','D','E','F#','G','A'],
    'F#': ['F#','G#','A','B','C#','D','E'],
    'C#': ['C#','D#','E','F#','G#','A','B'],
    'F' : ['F','G','Ab','Bb','C','Db','Eb'],
    'Bb': ['Bb','C','Db','Eb','F','Gb','Ab'],
    'Eb': ['Eb','F','Gb','Ab','Bb','Cb','Db'],
    'Ab': ['Ab','Bb','Cb','Db','Eb','Fb','Gb'],
    'Db': ['Db','Eb','Fb','Gb','Ab','Bbb','Cb'],
    'Gb': ['Gb','Ab','Bbb','Cb','Db','Ebb','Fb'],
  };

  /* Raised 7th degree for harmonic minor, correctly spelled per root */
  var HARM_MINOR_7 = {
    'C':'B',  'G':'F#', 'D':'C#', 'A':'G#', 'E':'D#', 'B':'A#',
    'F#':'E#','C#':'B#',
    'F':'E',  'Bb':'A', 'Eb':'D', 'Ab':'G', 'Db':'C', 'Gb':'F',
  };

  /* Semitone of each root from C */
  var ROOT_SEMI = {
    'C':0,'G':7,'D':2,'A':9,'E':4,'B':11,'F#':6,'C#':1,
    'F':5,'Bb':10,'Eb':3,'Ab':8,'Db':1,'Gb':6,
  };

  /* Scale interval patterns (semitones from root) */
  var SCALE_INTERVALS = {
    'Major':          [0,2,4,5,7,9,11],
    'Minor':          [0,2,3,5,7,8,10],
    'Harmonic Minor': [0,2,3,5,7,8,11],
    'Major Pent':     [0,2,4,7,9],
    'Minor Pent':     [0,3,5,7,10],
  };

  /* Build [{name, midi}, ...] for root + scale, 2 octaves + top root.
     MIDI base C3=48. */
  function buildScaleNotes(root, scaleName) {
    var rootSemi  = ROOT_SEMI[root] !== undefined ? ROOT_SEMI[root] : 0;
    var intervals = SCALE_INTERVALS[scaleName] || SCALE_INTERVALS['Major'];
    var names;

    if (scaleName === 'Major') {
      names = (MAJOR_SCALES[root] || MAJOR_SCALES['C']).slice();
    } else if (scaleName === 'Minor') {
      names = (MINOR_SCALES[root] || MINOR_SCALES['A']).slice();
    } else if (scaleName === 'Harmonic Minor') {
      names = (MINOR_SCALES[root] || MINOR_SCALES['A']).slice();
      names[6] = HARM_MINOR_7[root] || names[6];
    } else if (scaleName === 'Major Pent') {
      var mj = MAJOR_SCALES[root] || MAJOR_SCALES['C'];
      names = [mj[0], mj[1], mj[2], mj[4], mj[5]];
    } else if (scaleName === 'Minor Pent') {
      var mn = MINOR_SCALES[root] || MINOR_SCALES['A'];
      names = [mn[0], mn[2], mn[3], mn[4], mn[6]];
    } else {
      names = (MAJOR_SCALES[root] || MAJOR_SCALES['C']).slice();
    }

    var notes = [];
    for (var oct = 0; oct < 2; oct++) {
      for (var i = 0; i < names.length; i++) {
        notes.push({ name: names[i], midi: 48 + rootSemi + intervals[i] + oct * 12 });
      }
    }
    notes.push({ name: names[0], midi: 48 + rootSemi + 24 });
    return notes;
  }

  /* Re-resolve a stored midi pitch to its name in a new key context.
     Returns null if pitch is not diatonic. */
  function resolveNoteName(midi, root, scaleName) {
    var notes      = buildScaleNotes(root, scaleName);
    var pitchClass = ((midi % 12) + 12) % 12;
    for (var i = 0; i < notes.length; i++) {
      if (((notes[i].midi % 12) + 12) % 12 === pitchClass) return notes[i].name;
    }
    return null;
  }

  function noteToFreq(midi) {
    return 440 * Math.pow(2, (midi - 69) / 12);
  }

  /* ════════════════════════════════════════════════════════════
     AUDIO CONTEXT
  ════════════════════════════════════════════════════════════ */
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

  /* ════════════════════════════════════════════════════════════
     DEFAULT LOOP — rhythmic percussion pattern
     (matches original: 3 impulses in 1.6s, noise+click envelope)
  ════════════════════════════════════════════════════════════ */
  function generateDefaultLoop(ctx) {
    var sr  = ctx.sampleRate;
    var dur = 1.6;
    var buf = ctx.createBuffer(1, Math.floor(sr * dur), sr);
    var d   = buf.getChannelData(0);

    var positions = [0, Math.floor(sr * 0.4), Math.floor(sr * 1.0)];
    var envLen    = Math.floor(sr * 0.06);

    positions.forEach(function (pos) {
      for (var i = 0; i < envLen && pos + i < d.length; i++) {
        var env   = Math.exp(-i / (envLen * 0.25));
        var noise = (Math.random() * 2 - 1) * 0.5;
        var click = (i < 4 ? 1.0 : 0) * 0.8;
        d[pos + i] += (noise + click) * env;
      }
    });

    /* Normalise */
    var peak = 0;
    for (var i = 0; i < d.length; i++) { var a = Math.abs(d[i]); if (a > peak) peak = a; }
    if (peak > 0.001) { var s = 0.8 / peak; for (var i = 0; i < d.length; i++) d[i] *= s; }

    return buf;
  }

  /* ════════════════════════════════════════════════════════════
     MARIMBA BUFFER RENDER
  ════════════════════════════════════════════════════════════ */
  function renderMelodicBuffer(pads, bpm) {
    var ctx      = resumeCtx();
    var sr       = ctx.sampleRate;
    var stepSec  = 60 / bpm;
    var totalSec = pads.length * stepSec;
    var total    = Math.ceil(sr * totalSec);
    var buf      = ctx.createBuffer(2, total, sr);
    var L        = buf.getChannelData(0);
    var R        = buf.getChannelData(1);

    for (var i = 0; i < pads.length; i++) {
      var pad = pads[i];
      if (!pad || !pad.midi) continue;

      var freq      = noteToFreq(pad.midi);
      var startSamp = Math.floor(i * stepSec * sr);
      var durSamp   = Math.floor(Math.min(stepSec * 0.88, 1.35) * sr);
      var modFreq   = freq * 4.97;

      for (var s = 0; s < durSamp && (startSamp + s) < total; s++) {
        var t   = s / sr;
        var env = t < 0.007 ? (t / 0.007) : Math.exp(-(t - 0.007) * 5.5);
        var mod = Math.sin(2 * Math.PI * modFreq * t) * freq * 0.0008;
        var sig = Math.sin(2 * Math.PI * (freq + mod) * t) * env * 0.52;
        L[startSamp + s] += sig;
        R[startSamp + s] += sig;
      }
    }

    return { buffer: buf, duration: totalSec };
  }

  /* ════════════════════════════════════════════════════════════
     STATE
  ════════════════════════════════════════════════════════════ */
  var MODE = { DEFAULT: 'default', UPLOAD: 'upload', MIC: 'mic', MELODIC: 'melodic' };
  var currentMode = MODE.DEFAULT;

  var state = {
    buffer:    null,
    playing:   false,
    driftPct:  1.0,
    volA:      0.75,
    volB:      0.75,
    synced:    false,
    startTime: 0,
    offsetA:   0,
    offsetB:   0,
  };

  /* Audio nodes */
  var srcA = null, srcB = null;
  var gainA = null, gainB = null;
  var masterGain = null;

  /* Display */
  var dispTimer = null;

  /* Melodic sequencer */
  var melSteps  = 8;
  var melRoot   = 'C';
  var melScale  = 'Major';
  var melPads   = [];   /* [{name, midi} | null] */
  var melBpm    = 120;  /* kept in sync with #mel-bpm slider */
  var melActiveA = -1;
  var melActiveB = -1;

  /* Touch detection — on touch devices we skip the mouseenter hover delay
     so a single tap opens the note picker immediately (no double-tap needed) */
  var isTouchDevice = (('ontouchstart' in window) || (navigator.maxTouchPoints > 0));

  /* Mic */
  var mediaRec    = null;
  var recChunks   = [];
  var isRecording = false;
  var recTimer    = null;
  var recStartMs  = 0;

  /* Crop editor (upload + mic only).
     pending holds the full uploaded/recorded clip plus the selected region
     (start/end as 0..1 fractions). Nothing reaches the phase machine until
     the user presses "load tape". */
  var pending        = null;   /* { full: AudioBuffer, label: string, start: 0..1, end: 0..1 } */
  var cropDragTarget = null;

  /* ════════════════════════════════════════════════════════════
     PLAYBACK ENGINE (mirrors original approach exactly)
  ════════════════════════════════════════════════════════════ */

  function rateB() {
    return state.synced ? 1.0 : 1.0 + state.driftPct / 100;
  }

  function currentPosA() {
    if (!state.playing || !state.buffer) return state.offsetA;
    var elapsed = getCtx().currentTime - state.startTime;
    var len     = state.buffer.duration;
    return ((state.offsetA + elapsed * 1.0) % len + len) % len;
  }

  function currentPosB() {
    if (!state.playing || !state.buffer) return state.offsetB;
    var elapsed = getCtx().currentTime - state.startTime;
    var len     = state.buffer.duration;
    return ((state.offsetB + elapsed * rateB()) % len + len) % len;
  }

  function startPlayback(posA, posB) {
    stopNodes();
    var ctx = resumeCtx();
    var now = ctx.currentTime;

    masterGain = ctx.createGain();
    masterGain.gain.value = 1.0;
    masterGain.connect(ctx.destination);

    gainA = ctx.createGain(); gainA.gain.value = state.volA;
    gainB = ctx.createGain(); gainB.gain.value = state.volB;
    gainA.connect(masterGain);
    gainB.connect(masterGain);

    srcA = ctx.createBufferSource();
    srcA.buffer             = state.buffer;
    srcA.loop               = true;
    srcA.playbackRate.value = 1.0;
    srcA.connect(gainA);

    srcB = ctx.createBufferSource();
    srcB.buffer             = state.buffer;
    srcB.loop               = true;
    srcB.playbackRate.value = rateB();
    srcB.connect(gainB);

    var len   = state.buffer.duration;
    var safeA = ((posA % len) + len) % len;
    var safeB = ((posB % len) + len) % len;

    srcA.start(now, safeA);
    srcB.start(now, safeB);

    state.startTime = now;
    state.offsetA   = safeA;
    state.offsetB   = safeB;
  }

  function stopNodes() {
    if (srcA) { try { srcA.stop(); } catch(e) {} srcA = null; }
    if (srcB) { try { srcB.stop(); } catch(e) {} srcB = null; }
    if (gainA) { gainA.disconnect(); gainA = null; }
    if (gainB) { gainB.disconnect(); gainB = null; }
    if (masterGain) { masterGain.disconnect(); masterGain = null; }
  }

  function togglePlay() {
    if (!state.buffer) return;
    if (state.playing) {
      state.playing = false;
      stopNodes();
      stopDisplayTimer();
      setPlayBtn(false);
    } else {
      state.playing = true;
      startPlayback(state.offsetA, state.offsetB);
      startDisplayTimer();
      setPlayBtn(true);
    }
  }

  function resetMachine() {
    var wasPlaying = state.playing;
    state.playing = false;
    stopNodes();
    stopDisplayTimer();
    state.offsetA  = 0;
    state.offsetB  = 0;
    melActiveA     = -1;
    melActiveB     = -1;
    renderStepIndicators(-1, -1);
    if (wasPlaying && state.buffer) {
      state.playing = true;
      startPlayback(0, 0);
      startDisplayTimer();
    }
    updateDisplay(0, 0);
    setPlayBtn(state.playing);
  }

  function setPlayBtn(on) {
    var btn = document.getElementById('pm-play');
    if (!btn) return;
    btn.innerHTML = on ? 'stop' : 'play';
    btn.classList.toggle('on', on);
  }

  /* Stop playback and clear the loaded tape (play button disabled until the
     next "load tape"). Used when a new upload/recording is pending. */
  function unloadTape() {
    state.playing = false;
    stopNodes();
    stopDisplayTimer();
    state.buffer  = null;
    state.offsetA = 0;
    state.offsetB = 0;
    melActiveA    = -1;
    melActiveB    = -1;
    renderStepIndicators(-1, -1);
    var pb = document.getElementById('pm-play');
    if (pb) pb.disabled = true;
    setPlayBtn(false);
    updateDisplay(0, 0);
    updateRenderBtn();
  }

  /* ════════════════════════════════════════════════════════════
     SYNC HOLD (K) — mirrors original: stop & restart at position
  ════════════════════════════════════════════════════════════ */

  function engageSync() {
    if (state.synced || !state.playing) return;
    var pA = currentPosA();
    var pB = currentPosB();
    state.synced = true;
    startPlayback(pA, pB);
    var badge = document.getElementById('sync-badge');
    if (badge) badge.classList.add('synced');
  }

  function releaseSync() {
    if (!state.synced) return;
    var pA = currentPosA();
    var pB = currentPosB();
    state.synced = false;
    if (state.playing) startPlayback(pA, pB);
    var badge = document.getElementById('sync-badge');
    if (badge) badge.classList.remove('synced');
  }

  /* ════════════════════════════════════════════════════════════
     DISPLAY TIMER
  ════════════════════════════════════════════════════════════ */

  function startDisplayTimer() {
    stopDisplayTimer();
    dispTimer = setInterval(tickDisplay, 60);
  }

  function stopDisplayTimer() {
    if (dispTimer) { clearInterval(dispTimer); dispTimer = null; }
  }

  function tickDisplay() {
    if (!state.playing || !state.buffer) return;
    var pA = currentPosA();
    var pB = currentPosB();
    updateDisplay(pA, pB);

    /* Melodic step indicators */
    if (currentMode === MODE.MELODIC && melSteps > 0) {
      var stepSec = 60 / melBpm;
      var len     = state.buffer.duration;
      var sA = Math.floor(((pA % len) + len) % len / stepSec) % melSteps;
      var sB = Math.floor(((pB % len) + len) % len / stepSec) % melSteps;
      if (sA !== melActiveA || sB !== melActiveB) {
        melActiveA = sA;
        melActiveB = sB;
        renderStepIndicators(sA, sB);
      }
    }
  }

  function updateDisplay(pA, pB) {
    var len    = state.buffer ? state.buffer.duration : 1;
    var offset = ((pB - pA) % len + len) % len;
    var pct    = len > 0 ? (offset / len) * 100 : 0;

    var dA  = document.getElementById('disp-a');
    var dB  = document.getElementById('disp-b');
    var dOff = document.getElementById('disp-offset');
    var bar  = document.getElementById('phase-bar');
    if (dA)  dA.textContent    = pA.toFixed(3) + ' s';
    if (dB)  dB.textContent    = pB.toFixed(3) + ' s';
    if (dOff) dOff.textContent = offset.toFixed(3) + ' s';
    if (bar)  bar.style.width  = pct.toFixed(1) + '%';
  }

  /* ════════════════════════════════════════════════════════════
     MELODIC STEP INDICATORS
  ════════════════════════════════════════════════════════════ */
  function renderStepIndicators(sA, sB) {
    var wrap = document.getElementById('mel-pads');
    if (!wrap) return;
    var pads = wrap.querySelectorAll('.mel-pad');
    for (var i = 0; i < pads.length; i++) {
      var indA = pads[i].querySelector('.step-ind-a');
      var indB = pads[i].querySelector('.step-ind-b');
      if (indA) indA.style.visibility = (i === sA) ? 'visible' : 'hidden';
      if (indB) indB.style.visibility = (i === sB) ? 'visible' : 'hidden';
    }
  }

  /* ════════════════════════════════════════════════════════════
     BUFFER HELPERS
  ════════════════════════════════════════════════════════════ */

  /* Scale the whole buffer (all channels) so channel-0 peak equals target. */
  function normalizeBuffer(buf, target) {
    var ch   = buf.getChannelData(0);
    var peak = 0;
    for (var i = 0; i < ch.length; i++) { var a = Math.abs(ch[i]); if (a > peak) peak = a; }
    if (peak > 0.001) {
      var sc = target / peak;
      for (var c = 0; c < buf.numberOfChannels; c++) {
        var data = buf.getChannelData(c);
        for (var j = 0; j < data.length; j++) data[j] *= sc;
      }
    }
    return buf;
  }

  /* Keep only the first maxSec seconds. Returns the same buffer if already short enough. */
  function trimBuffer(ctx, buffer, maxSec) {
    if (buffer.duration <= maxSec) return buffer;
    var frames = Math.floor(maxSec * buffer.sampleRate);
    var out = ctx.createBuffer(buffer.numberOfChannels, frames, buffer.sampleRate);
    for (var c = 0; c < buffer.numberOfChannels; c++) {
      out.getChannelData(c).set(buffer.getChannelData(c).subarray(0, frames));
    }
    return out;
  }

  /* Copy out the region between two 0..1 fractions as a new buffer. */
  function sliceBuffer(ctx, buffer, startFrac, endFrac) {
    var startSamp = Math.floor(startFrac * buffer.length);
    var endSamp   = Math.max(startSamp + 1, Math.floor(endFrac * buffer.length));
    var frames    = endSamp - startSamp;
    var out = ctx.createBuffer(buffer.numberOfChannels, frames, buffer.sampleRate);
    for (var c = 0; c < buffer.numberOfChannels; c++) {
      out.getChannelData(c).set(buffer.getChannelData(c).subarray(startSamp, endSamp));
    }
    return out;
  }

  /* Seamless-loop crossfade.
     The last F samples are blended into the first F samples (equal-power) and
     the loop starts F samples in, so the wrap point runs from in[F-1] straight
     into in[F] — continuous, no click. The loop is F samples shorter than the
     crop. F is capped at MAX_XFADE_FRAC of the crop length. */
  function applyLoopCrossfade(ctx, buf, fadeMs) {
    var L = buf.length;
    var F = Math.floor((fadeMs / 1000) * buf.sampleRate);
    F = Math.min(F, Math.floor(L * MAX_XFADE_FRAC));
    if (F < 2) return buf;

    var N    = L - F;
    var body = N - F;
    var out  = ctx.createBuffer(buf.numberOfChannels, N, buf.sampleRate);

    for (var c = 0; c < buf.numberOfChannels; c++) {
      var inp = buf.getChannelData(c);
      var o   = out.getChannelData(c);
      var i, j;
      for (i = 0; i < body; i++) o[i] = inp[F + i];
      for (j = 0; j < F; j++) {
        var t    = j / F;
        var gOut = Math.cos(t * Math.PI / 2);
        var gIn  = Math.sin(t * Math.PI / 2);
        o[body + j] = inp[L - F + j] * gOut + inp[j] * gIn;
      }
    }
    return out;
  }

  /* ════════════════════════════════════════════════════════════
     BUFFER LOADING (shared final step for all sources)
  ════════════════════════════════════════════════════════════ */

  function loadBuffer(buf, label) {
    normalizeBuffer(buf, 0.78);

    state.playing = false;
    stopNodes();
    stopDisplayTimer();
    state.buffer  = buf;
    state.offsetA = 0;
    state.offsetB = 0;
    melActiveA    = -1;
    melActiveB    = -1;
    renderStepIndicators(-1, -1);

    var playBtn = document.getElementById('pm-play');
    if (playBtn) playBtn.disabled = false;
    setPlayBtn(false);
    setTapeStatus(label, true);
    updateDisplay(0, 0);
    updateRenderBtn();
  }

  function setTapeStatus(msg, fade) {
    var el = document.getElementById('tape-status');
    if (!el) return;
    el.textContent   = msg;
    el.style.opacity = '1';
    clearTimeout(el._fadeTimer);
    if (fade) {
      el._fadeTimer = setTimeout(function () { el.style.opacity = '0'; }, 2400);
    }
  }

  /* ════════════════════════════════════════════════════════════
     FILE / BLOB READING + DECODING (iOS-safe)
     - file.arrayBuffer() with a FileReader fallback
     - decodeAudioData in both promise and callback form (older Safari
       only supports the callback form)
  ════════════════════════════════════════════════════════════ */
  function readBlobBuffer(blob) {
    if (blob.arrayBuffer) return blob.arrayBuffer();
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload  = function () { resolve(r.result); };
      r.onerror = function () { reject(r.error || new Error('could not read file')); };
      r.readAsArrayBuffer(blob);
    });
  }

  function decodeAudio(arrayBuffer) {
    var ctx = resumeCtx();
    return new Promise(function (resolve, reject) {
      var settled = false;
      function ok(b)   { if (!settled) { settled = true; resolve(b); } }
      function fail(e) { if (!settled) { settled = true; reject(e || new Error('decode failed')); } }
      try {
        var p = ctx.decodeAudioData(arrayBuffer, ok, fail);
        if (p && typeof p.then === 'function') p.then(ok, fail);
      } catch (e) { fail(e); }
    });
  }

  function fmtSize(bytes) {
    if (bytes >= 1048576) return (bytes / 1048576).toFixed(1) + ' MB';
    return Math.max(1, Math.round(bytes / 1024)) + ' KB';
  }

  /* Short, readable description of a file — shown in error messages so a
     failure can be diagnosed on a phone without a console. */
  function describeFile(name, type, size) {
    var nm  = name || 'recording';
    var dot = nm.lastIndexOf('.');
    var ext = dot > -1 ? nm.slice(dot).toLowerCase() : 'no extension';
    return nm.substring(0, 28) + ' (' + ext + ', ' + (type || 'unknown type') + ', ' + fmtSize(size || 0) + ')';
  }

  function errText(err) {
    if (!err) return '';
    var n = (err.name && err.name !== 'Error') ? err.name : '';
    var m = err.message || '';
    var s = n + (n && m ? ': ' : '') + m;
    return s ? ' — ' + s.substring(0, 80) : '';
  }

  /* ════════════════════════════════════════════════════════════
     SOURCE: DEFAULT
  ════════════════════════════════════════════════════════════ */
  function loadDefault() {
    abortRecording();
    clearPending();
    currentMode = MODE.DEFAULT;
    setSrcUI('default');
    hideMelEditor();
    hideMicPanel();
    loadBuffer(generateDefaultLoop(resumeCtx()), 'default loop loaded');
  }

  /* ════════════════════════════════════════════════════════════
     SOURCE: FILE UPLOAD
     Decode → trim to MAX_UPLOAD_SEC → show crop editor → wait for "load tape".
  ════════════════════════════════════════════════════════════ */
  function loadFile(file) {
    setTapeStatus('loading…', false);

    readBlobBuffer(file)
      .then(function (ab) {
        if (!ab || ab.byteLength === 0) {
          var e = new Error('file is empty (if it is in iCloud, download it first)');
          e.name = 'EmptyFile';
          throw e;
        }
        return decodeAudio(ab);
      })
      .then(function (decoded) {
        var trimmed    = trimBuffer(getCtx(), decoded, MAX_UPLOAD_SEC);
        var wasTrimmed = trimmed !== decoded;
        var label      = 'loaded: ' + file.name.substring(0, 28);

        abortRecording();
        currentMode = MODE.UPLOAD;
        setSrcUI('file');
        hideMelEditor();
        hideMicPanel();

        setPending(
          trimmed,
          label,
          label + (wasTrimmed ? ' (first ' + MAX_UPLOAD_SEC + ' s)' : '') + ' — crop, then load tape →'
        );
      })
      .catch(function (err) {
        setTapeStatus('could not load ' + describeFile(file.name, file.type, file.size) + errText(err), false);
      });
  }

  /* ════════════════════════════════════════════════════════════
     SOURCE: MICROPHONE
     Record (with countdown) → decode → crop editor → "load tape".
  ════════════════════════════════════════════════════════════ */
  function activateMicMode() {
    abortRecording();
    currentMode = MODE.MIC;
    setSrcUI('mic');
    hideMelEditor();
    showMicPanel();
    clearPending();
    unloadTape();
    setRecUI('idle');
    setTapeStatus('press record (max ' + MAX_REC_SEC + ' s), then crop and load tape →', false);
  }

  /* Pick a recorder MIME type this browser actually supports.
     iOS Safari records audio/mp4; Chrome/Firefox record webm/ogg. */
  function pickRecMime() {
    if (!window.MediaRecorder || typeof MediaRecorder.isTypeSupported !== 'function') return '';
    var candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
    for (var i = 0; i < candidates.length; i++) {
      if (MediaRecorder.isTypeSupported(candidates[i])) return candidates[i];
    }
    return '';
  }

  function fmtCountdown(sec) {
    var s = Math.max(0, Math.ceil(sec));
    return Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2);
  }

  function startRecCountdown() {
    stopRecCountdown();
    recStartMs = Date.now();
    var tick = function () {
      var left = MAX_REC_SEC - (Date.now() - recStartMs) / 1000;
      if (left <= 0) { stopRec(); return; }
      setTapeStatus('recording… ' + fmtCountdown(left) + ' left — press stop when done', false);
    };
    tick();
    recTimer = setInterval(tick, 100);
  }

  function stopRecCountdown() {
    if (recTimer) { clearInterval(recTimer); recTimer = null; }
  }

  function startRec() {
    if (isRecording) { stopRec(); return; }

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !window.MediaRecorder) {
      setTapeStatus('recording is not supported in this browser (a secure https page is required)', false);
      return;
    }

    resumeCtx(); /* inside the tap, so iOS allows playback later */

    navigator.mediaDevices.getUserMedia({ audio: true, video: false })
      .then(function (stream) {
        var mime = pickRecMime();
        var recorder;
        try {
          recorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
        } catch (e) {
          stream.getTracks().forEach(function (t) { t.stop(); });
          setTapeStatus('could not start recorder' + errText(e), false);
          return;
        }

        mediaRec  = recorder;
        recChunks = [];
        recorder._discard = false;

        recorder.ondataavailable = function (e) { if (e.data && e.data.size > 0) recChunks.push(e.data); };

        recorder.onerror = function (e) {
          stream.getTracks().forEach(function (t) { t.stop(); });
          stopRecCountdown();
          isRecording = false;
          setRecUI('idle');
          setTapeStatus('recording error' + errText(e && e.error), false);
        };

        recorder.onstop = function () {
          stream.getTracks().forEach(function (t) { t.stop(); });
          stopRecCountdown();
          if (recorder._discard) return;

          isRecording = false;
          var type = recorder.mimeType || mime || 'audio/mp4';
          var blob = new Blob(recChunks, { type: type });

          if (blob.size === 0) {
            setRecUI('idle');
            setTapeStatus('nothing was recorded — try again', false);
            return;
          }

          setTapeStatus('processing recording…', false);
          readBlobBuffer(blob)
            .then(decodeAudio)
            .then(function (decoded) {
              setRecUI('has_rec');
              setPending(decoded, 'microphone recording', 'recording ready — crop, then load tape →');
            })
            .catch(function (err) {
              setRecUI('idle');
              setTapeStatus('could not decode ' + describeFile('recording', type, blob.size) + errText(err), false);
            });
        };

        recorder.start();
        isRecording = true;
        setRecUI('recording');
        startRecCountdown();
      })
      .catch(function (err) {
        if (err && (err.name === 'NotAllowedError' || err.name === 'SecurityError')) {
          setTapeStatus('mic access denied — allow the microphone for this site and try again', false);
        } else {
          setTapeStatus('mic error' + errText(err), false);
        }
      });
  }

  function stopRec() {
    stopRecCountdown();
    if (mediaRec && isRecording && mediaRec.state !== 'inactive') {
      try { mediaRec.stop(); } catch (e) {}
    }
  }

  /* Stop and throw away an in-progress recording (used when switching source). */
  function abortRecording() {
    if (!isRecording) return;
    stopRecCountdown();
    isRecording = false;
    if (mediaRec) {
      mediaRec._discard = true;
      try { if (mediaRec.state !== 'inactive') mediaRec.stop(); } catch (e) {}
    }
  }

  function setRecUI(s) {
    var rb = document.getElementById('pm-record');
    var sl = document.getElementById('pm-rec-state');
    var nb = document.getElementById('pm-rec-new');
    if (!rb) return;
    if (s === 'idle') {
      rb.innerHTML = 'record'; rb.classList.remove('on');
      rb.style.display = 'inline-block';
      if (sl) sl.style.display = 'none';
      if (nb) nb.style.display = 'none';
    } else if (s === 'recording') {
      rb.innerHTML = 'stop'; rb.classList.add('on');
      rb.style.display = 'inline-block';
      if (sl) sl.style.display = 'none';
      if (nb) nb.style.display = 'none';
    } else if (s === 'has_rec') {
      rb.style.display = 'none';
      if (sl) { sl.textContent = 'recorded!'; sl.style.display = 'inline'; }
      if (nb) nb.style.display = 'inline-block';
    }
  }

  function showMicPanel() {
    var rb = document.getElementById('pm-record');
    var rs = document.getElementById('pm-rec-state');
    if (rb) rb.style.display = 'inline-block';
    if (rs) rs.style.display = 'none';
  }

  function hideMicPanel() {
    var rb = document.getElementById('pm-record');
    var rs = document.getElementById('pm-rec-state');
    var rn = document.getElementById('pm-rec-new');
    if (rb) rb.style.display = 'none';
    if (rs) rs.style.display = 'none';
    if (rn) rn.style.display = 'none';
  }

  /* ════════════════════════════════════════════════════════════
     CROP EDITOR (upload + microphone only)
  ════════════════════════════════════════════════════════════ */
  function cropEl(id) { return document.getElementById(id); }

  function setPending(buf, label, statusMsg) {
    normalizeBuffer(buf, 0.85);   /* so quiet clips draw a readable waveform */
    pending = { full: buf, label: label, start: 0, end: 1 };

    unloadTape();                 /* new clip pending: old tape stops, play disabled */

    var ed = cropEl('pm-source-editor');
    if (ed) ed.style.display = 'block';
    drawSourceWaveform();         /* canvas must be visible to have a width */
    updateSelectionUI();

    var lt = cropEl('load-tape-btn');
    if (lt) lt.disabled = false;

    setTapeStatus(statusMsg, false);
  }

  function clearPending() {
    pending = null;
    cropDragTarget = null;
    var ed = cropEl('pm-source-editor');
    if (ed) ed.style.display = 'none';
    var lt = cropEl('load-tape-btn');
    if (lt) lt.disabled = true;
  }

  function fmtClock(s) {
    var m = Math.floor(s / 60), ss = (s % 60).toFixed(1);
    return m + ':' + ss.padStart(4, '0');
  }

  function drawSourceWaveform() {
    var canvas = cropEl('pm-src-wave');
    if (!canvas || !pending) return;
    var ctx = canvas.getContext('2d'), dpr = window.devicePixelRatio || 1;
    var cssH = canvas.offsetHeight || 50;
    canvas.width = canvas.offsetWidth * dpr; canvas.height = cssH * dpr;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    var data = pending.full.getChannelData(0), W = canvas.width, H = canvas.height;
    if (!W) return;
    var step = Math.ceil(data.length / W);
    var textColor = getComputedStyle(document.body).getPropertyValue('--text').trim() || '#1a1a1a';
    ctx.fillStyle = textColor;
    for (var x = 0; x < W; x++) {
      var max = 0, min = 0;
      for (var j = 0; j < step; j++) { var v = data[x * step + j] || 0; if (v > max) max = v; if (v < min) min = v; }
      var y1 = (1 - max) * H / 2, y2 = (1 - min) * H / 2;
      ctx.globalAlpha = 0.3; ctx.fillRect(x, y1, 1, Math.max(1, y2 - y1));
    }
    ctx.globalAlpha = 1;
  }

  function updateSelectionUI() {
    if (!pending) return;
    var sH = cropEl('pm-handle-start'), eH = cropEl('pm-handle-end');
    var mL = cropEl('pm-select-mask-left'), mR = cropEl('pm-select-mask-right');
    if (sH) sH.style.left = (pending.start * 100) + '%';
    if (eH) eH.style.left = (pending.end * 100) + '%';
    if (mL) mL.style.width = (pending.start * 100) + '%';
    if (mR) mR.style.width = ((1 - pending.end) * 100) + '%';
    var dur = pending.full.duration;
    var startSec = pending.start * dur, endSec = pending.end * dur;
    var lbl = cropEl('pm-src-range-label');
    if (lbl) lbl.textContent = fmtClock(startSec) + ' \u2013 ' + fmtClock(endSec) + '  (' + (endSec - startSec).toFixed(1) + 's selected)';
  }

  function initCropEditor() {
    var wrap = cropEl('pm-src-wave-wrap');
    var sH = cropEl('pm-handle-start'), eH = cropEl('pm-handle-end');
    if (!wrap || !sH || !eH) return;

    function fracFromEvent(e) {
      var rect = wrap.getBoundingClientRect();
      var x = e.clientX - rect.left;
      return Math.max(0, Math.min(1, x / rect.width));
    }
    function beginDrag(target) {
      return function (e) {
        e.preventDefault();
        cropDragTarget = target;
        try { e.target.setPointerCapture(e.pointerId); } catch (err) {}
      };
    }
    sH.addEventListener('pointerdown', beginDrag('start'));
    eH.addEventListener('pointerdown', beginDrag('end'));

    document.addEventListener('pointermove', function (e) {
      if (!cropDragTarget || !pending) return;
      var f = fracFromEvent(e);
      var minGap = Math.min(1, MIN_CROP_SEC / pending.full.duration);
      if (cropDragTarget === 'start') pending.start = Math.max(0, Math.min(f, pending.end - minGap));
      else                            pending.end   = Math.min(1, Math.max(f, pending.start + minGap));
      updateSelectionUI();
    });
    function endDrag() { cropDragTarget = null; }
    document.addEventListener('pointerup', endDrag);
    document.addEventListener('pointercancel', endDrag);

    var xf = cropEl('pm-crossfade');
    var xfVal = cropEl('pm-crossfade-val');
    if (xf) xf.addEventListener('input', function (e) {
      if (xfVal) xfVal.textContent = e.target.value + ' ms';
    });

    window.addEventListener('resize', function () {
      if (pending) drawSourceWaveform();
    });
  }

  /* "load tape" for upload + mic: slice the selection, apply the loop
     crossfade, hand it to the phase machine (which resets both tapes to 0). */
  function commitTape() {
    if (!pending) { setTapeStatus('nothing to load yet', true); return; }
    var ctx    = getCtx();
    var sliced = sliceBuffer(ctx, pending.full, pending.start, pending.end);
    var xf     = cropEl('pm-crossfade');
    var fadeMs = xf ? (parseInt(xf.value, 10) || 0) : 0;
    var looped = applyLoopCrossfade(ctx, sliced, fadeMs);
    loadBuffer(looped, pending.label + ' · ' + looped.duration.toFixed(2) + ' s loop');
  }

  /* ════════════════════════════════════════════════════════════
     OFFLINE RENDER → WAV DOWNLOAD
     Renders the loaded tape as two looping players (A at normal speed, B at
     1 + drift%) with the current volumes, both starting from 0:00 — the same
     result as pressing reset, then play. Sync hold (K) is a live gesture and
     is not part of the render.
  ════════════════════════════════════════════════════════════ */
  function audioBufferToWav(buffer) {
    var numCh = buffer.numberOfChannels, sr = buffer.sampleRate, len = buffer.length;
    var dataLen = len * numCh * 2;
    var ab = new ArrayBuffer(44 + dataLen), view = new DataView(ab);
    var ws = function (off, str) { for (var i = 0; i < str.length; i++) view.setUint8(off + i, str.charCodeAt(i)); };
    ws(0, 'RIFF'); view.setUint32(4, 36 + dataLen, true); ws(8, 'WAVE');
    ws(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
    view.setUint16(22, numCh, true); view.setUint32(24, sr, true);
    view.setUint32(28, sr * numCh * 2, true); view.setUint16(32, numCh * 2, true); view.setUint16(34, 16, true);
    ws(36, 'data'); view.setUint32(40, dataLen, true);
    var chans = [];
    for (var c = 0; c < numCh; c++) chans.push(buffer.getChannelData(c));
    var off = 44;
    for (var i = 0; i < len; i++) {
      for (var ch = 0; ch < numCh; ch++) {
        var s = Math.max(-1, Math.min(1, chans[ch][i]));
        view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7FFF, true); off += 2;
      }
    }
    return new Blob([ab], { type: 'audio/wav' });
  }

  function renderMix(durationSec) {
    var ctx = getCtx();
    var sr  = ctx.sampleRate;
    var OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    var off = new OAC(2, Math.ceil(sr * durationSec), sr);

    var out = off.createGain();
    out.gain.value = 1.0;
    out.connect(off.destination);

    function addTape(rate, vol) {
      var src = off.createBufferSource();
      src.buffer             = state.buffer;
      src.loop               = true;
      src.playbackRate.value = rate;
      var g = off.createGain();
      g.gain.value = vol;
      src.connect(g);
      g.connect(out);
      src.start(0, 0);
    }
    addTape(1.0, state.volA);
    addTape(1.0 + state.driftPct / 100, state.volB);

    return new Promise(function (resolve, reject) {
      try {
        off.oncomplete = function (e) { resolve(e.renderedBuffer); };
        var p = off.startRendering();
        if (p && typeof p.then === 'function') p.then(resolve, reject);
      } catch (e) { reject(e); }
    });
  }

  /* Two overlapping tapes can sum past full scale; scale down only if needed
     so the WAV never hard-clips. */
  function guardPeak(buf) {
    var peak = 0;
    for (var c = 0; c < buf.numberOfChannels; c++) {
      var d = buf.getChannelData(c);
      for (var i = 0; i < d.length; i++) { var a = Math.abs(d[i]); if (a > peak) peak = a; }
    }
    if (peak > 0.98) {
      var sc = 0.98 / peak;
      for (var c2 = 0; c2 < buf.numberOfChannels; c2++) {
        var data = buf.getChannelData(c2);
        for (var j = 0; j < data.length; j++) data[j] *= sc;
      }
    }
    return buf;
  }

  function updateRenderBtn() {
    var btn = document.getElementById('pm-download-btn');
    if (btn) btn.disabled = !state.buffer || rendering;
  }
  var rendering = false;

  function initDownload() {
    var btn    = document.getElementById('pm-download-btn');
    var durSel = document.getElementById('pm-download-dur');
    var status = document.getElementById('pm-download-status');
    if (!btn) return;

    btn.addEventListener('click', function () {
      if (!state.buffer || rendering) return;
      var dur = parseInt(durSel ? durSel.value : '60', 10) || 60;
      rendering = true; updateRenderBtn();
      if (status) status.textContent = 'rendering…';

      renderMix(dur)
        .then(function (rendered) {
          var blob = audioBufferToWav(guardPeak(rendered));
          var url  = URL.createObjectURL(blob);
          var a    = document.createElement('a');
          a.href = url; a.download = 'phase-machine-' + Date.now() + '.wav';
          document.body.appendChild(a); a.click(); document.body.removeChild(a);
          setTimeout(function () { URL.revokeObjectURL(url); }, 10000);
          if (status) status.textContent = 'done';
          setTimeout(function () { if (status) status.textContent = ''; }, 3000);
        })
        .catch(function (err) {
          if (status) status.textContent = 'render failed' + errText(err);
        })
        .then(function () { rendering = false; updateRenderBtn(); });
    });
  }

  /* ════════════════════════════════════════════════════════════
     SOURCE: MELODIC
  ════════════════════════════════════════════════════════════ */
  function activateMelodicMode() {
    abortRecording();
    clearPending();
    currentMode = MODE.MELODIC;
    setSrcUI('melodic');
    hideMicPanel();
    showMelEditor();
    setTapeStatus('build your sequence, then load tape →', false);
  }

  function commitMelodicTape() {
    /* Read current BPM from slider before rendering */
    var bpmEl = document.getElementById('mel-bpm');
    if (bpmEl) melBpm = parseInt(bpmEl.value, 10) || 120;
    var result = renderMelodicBuffer(melPads, melBpm);
    clearPending();
    currentMode = MODE.MELODIC;
    setSrcUI('melodic');
    hideMicPanel();
    showMelEditor();
    loadBuffer(result.buffer, 'melodic sequence loaded');
  }

  /* ════════════════════════════════════════════════════════════
     SOURCE UI HELPER
  ════════════════════════════════════════════════════════════ */
  function setSrcUI(type) {
    var sd = document.getElementById('src-default');
    var sm = document.getElementById('src-mic');
    var sl = document.getElementById('src-melodic');
    var ul = document.getElementById('pm-upload-label');
    if (sd) sd.classList.toggle('on', type === 'default');
    if (sm) sm.classList.toggle('on', type === 'mic');
    if (sl) sl.classList.toggle('on', type === 'melodic');
    if (ul) ul.classList.toggle('on', type === 'file');
  }

  /* ════════════════════════════════════════════════════════════
     MELODIC EDITOR — PAD BUILDING
  ════════════════════════════════════════════════════════════ */
  function showMelEditor() {
    var ed = document.getElementById('melodic-editor');
    if (ed) ed.style.display = 'block';
    var wrap = document.getElementById('mel-pads');
    if (wrap && !wrap.children.length) buildPads();
  }

  function hideMelEditor() {
    var ed = document.getElementById('melodic-editor');
    if (ed) ed.style.display = 'none';
  }

  function buildPads() {
    var wrap = document.getElementById('mel-pads');
    if (!wrap) return;
    var stepsEl = document.getElementById('mel-steps');
    melSteps = stepsEl ? parseInt(stepsEl.value, 10) : 8;

    while (melPads.length < melSteps) melPads.push(null);
    melPads = melPads.slice(0, melSteps);

    wrap.innerHTML = '';
    for (var i = 0; i < melSteps; i++) {
      wrap.appendChild(makePad(i));
    }
  }

  function makePad(i) {
    var pad = document.createElement('div');
    pad.className    = 'mel-pad';
    pad.dataset.index = String(i);

    var num = document.createElement('span');
    num.className   = 'step-num';
    num.textContent = String(i + 1);

    var nameSp = document.createElement('span');
    nameSp.className   = 'step-note-name';
    nameSp.textContent = melPads[i] ? melPads[i].name : '—';

    var indRow = document.createElement('span');
    indRow.className = 'step-ind-row';

    var indA = document.createElement('span');
    indA.className        = 'step-ind-a';
    indA.textContent      = 'A';
    indA.style.visibility = 'hidden';

    var indB = document.createElement('span');
    indB.className        = 'step-ind-b';
    indB.textContent      = 'B';
    indB.style.visibility = 'hidden';

    indRow.appendChild(indA);
    indRow.appendChild(indB);

    var picker = makePicker(i);

    pad.appendChild(num);
    pad.appendChild(nameSp);
    pad.appendChild(indRow);
    pad.appendChild(picker);

    /* Click / tap: open picker immediately (works for both mouse and touch).
       On touch devices this is the only interaction path — no hover delay. */
    pad.addEventListener('click', function (e) {
      if (e.target.closest('.note-picker')) return;
      var isOpen = picker.classList.contains('visible');
      closeAllPickers();
      if (!isOpen) picker.classList.add('visible');
    });

    /* Hover (desktop only): open after short delay, close on leave */
    if (!isTouchDevice) {
      var hoverTimer = null;
      pad.addEventListener('mouseenter', function () {
        clearTimeout(hoverTimer);
        hoverTimer = setTimeout(function () {
          closeAllPickers();
          picker.classList.add('visible');
        }, 150);
      });
      pad.addEventListener('mouseleave', function (e) {
        clearTimeout(hoverTimer);
        if (picker.contains(e.relatedTarget)) return;
        picker.classList.remove('visible');
      });
      picker.addEventListener('mouseleave', function (e) {
        if (!pad.contains(e.relatedTarget)) picker.classList.remove('visible');
      });
    }

    return pad;
  }

  function makePicker(padIndex) {
    var rootEl  = document.getElementById('mel-root');
    var scaleEl = document.getElementById('mel-scale');
    var root    = rootEl  ? rootEl.value  : 'C';
    var scale   = scaleEl ? scaleEl.value : 'Major';
    var notes   = buildScaleNotes(root, scale);

    var picker = document.createElement('div');
    picker.className = 'note-picker';

    /* Rest */
    picker.appendChild(makePickBtn('rest', melPads[padIndex] === null, function () {
      melPads[padIndex] = null;
      refreshPadLabel(padIndex);
      picker.classList.remove('visible');
    }));

    /* Notes */
    notes.forEach(function (note) {
      var sel = melPads[padIndex] !== null && melPads[padIndex].midi === note.midi;
      picker.appendChild(makePickBtn(note.name, sel, function () {
        melPads[padIndex] = { name: note.name, midi: note.midi };
        refreshPadLabel(padIndex);
        picker.classList.remove('visible');
      }));
    });

    return picker;
  }

  function makePickBtn(label, selected, onClick) {
    var btn = document.createElement('button');
    btn.className   = 'note-pick-btn' + (selected ? ' selected' : '');
    btn.textContent = label;
    btn.addEventListener('click', function (e) { e.stopPropagation(); onClick(); });
    return btn;
  }

  function refreshPadLabel(index) {
    var wrap = document.getElementById('mel-pads');
    if (!wrap) return;
    var padEl  = wrap.querySelectorAll('.mel-pad')[index];
    if (!padEl) return;
    var nameEl = padEl.querySelector('.step-note-name');
    if (nameEl) nameEl.textContent = melPads[index] ? melPads[index].name : '—';
    var cur    = melPads[index];
    padEl.querySelectorAll('.note-pick-btn').forEach(function (btn) {
      var isRest = cur === null  && btn.textContent === 'rest';
      var isNote = cur !== null  && btn.textContent === cur.name;
      btn.classList.toggle('selected', isRest || isNote);
    });
  }

  function closeAllPickers() {
    document.querySelectorAll('.note-picker').forEach(function (p) {
      p.classList.remove('visible');
    });
  }

  function onKeyOrScaleChange() {
    var rootEl  = document.getElementById('mel-root');
    var scaleEl = document.getElementById('mel-scale');
    melRoot  = rootEl  ? rootEl.value  : 'C';
    melScale = scaleEl ? scaleEl.value : 'Major';
    /* Re-resolve stored notes; clear if no longer diatonic */
    for (var i = 0; i < melPads.length; i++) {
      if (!melPads[i]) continue;
      var newName = resolveNoteName(melPads[i].midi, melRoot, melScale);
      melPads[i] = newName ? { midi: melPads[i].midi, name: newName } : null;
    }
    buildPads();
  }

  /* ════════════════════════════════════════════════════════════
     INIT
  ════════════════════════════════════════════════════════════ */
  function init() {

    /* Source buttons */
    var srcDefault = document.getElementById('src-default');
    var srcMic     = document.getElementById('src-mic');
    var srcMelodic = document.getElementById('src-melodic');
    var fileInput  = document.getElementById('pm-file-input');
    var uploadLbl  = document.getElementById('pm-upload-label');

    if (srcDefault)  srcDefault.addEventListener('click', loadDefault);
    if (srcMic)      srcMic.addEventListener('click', activateMicMode);
    if (srcMelodic)  srcMelodic.addEventListener('click', activateMelodicMode);

    /* Unlock audio on the tap itself — iOS only allows this inside a gesture */
    if (uploadLbl)   uploadLbl.addEventListener('click', resumeCtx);
    if (fileInput)   fileInput.addEventListener('click', resumeCtx);
    if (fileInput)   fileInput.addEventListener('change', function (e) {
      if (e.target.files && e.target.files[0]) loadFile(e.target.files[0]);
      e.target.value = '';
    });

    /* Mic controls */
    var recBtn  = document.getElementById('pm-record');
    var recNew  = document.getElementById('pm-rec-new');
    var loadBtn = document.getElementById('load-tape-btn');
    if (recBtn)  recBtn.addEventListener('click', startRec);
    if (recNew)  recNew.addEventListener('click', function () {
      abortRecording();
      clearPending();
      unloadTape();
      setRecUI('idle');
      setTapeStatus('press record (max ' + MAX_REC_SEC + ' s), then crop and load tape →', false);
    });
    if (loadBtn) loadBtn.addEventListener('click', commitTape);

    /* Crop editor */
    initCropEditor();

    /* Render + download */
    initDownload();

    /* Transport */
    var playBtn  = document.getElementById('pm-play');
    var resetBtn = document.getElementById('pm-reset');
    if (playBtn)  playBtn.addEventListener('click', togglePlay);
    if (resetBtn) resetBtn.addEventListener('click', resetMachine);

    /* Sliders */
    var driftSl = document.getElementById('pm-drift');
    var volASl  = document.getElementById('pm-vol-a');
    var volBSl  = document.getElementById('pm-vol-b');

    if (driftSl) driftSl.addEventListener('input', function (e) {
      state.driftPct = parseFloat(e.target.value);
      var label = '+' + state.driftPct.toFixed(1) + '%';
      var dv = document.getElementById('pm-drift-val');
      var dd = document.getElementById('disp-drift');
      if (dv) dv.textContent = label;
      if (dd) dd.textContent = label;
      if (state.playing && !state.synced && srcB) {
        srcB.playbackRate.setValueAtTime(rateB(), getCtx().currentTime);
      }
    });

    if (volASl) volASl.addEventListener('input', function (e) {
      state.volA = parseFloat(e.target.value);
      var va = document.getElementById('pm-vol-a-val');
      if (va) va.textContent = Math.round(state.volA * 100) + '%';
      if (gainA) gainA.gain.setValueAtTime(state.volA, getCtx().currentTime);
    });

    if (volBSl) volBSl.addEventListener('input', function (e) {
      state.volB = parseFloat(e.target.value);
      var vb = document.getElementById('pm-vol-b-val');
      if (vb) vb.textContent = Math.round(state.volB * 100) + '%';
      if (gainB) gainB.gain.setValueAtTime(state.volB, getCtx().currentTime);
    });

    /* Melodic editor controls */
    var melStepsEl = document.getElementById('mel-steps');
    var melRootEl  = document.getElementById('mel-root');
    var melScaleEl = document.getElementById('mel-scale');
    var melBpmEl   = document.getElementById('mel-bpm');
    var melBpmVal  = document.getElementById('mel-bpm-val');
    var melClear   = document.getElementById('mel-clear');
    var melLoad    = document.getElementById('mel-load');

    if (melStepsEl) melStepsEl.addEventListener('change', buildPads);
    if (melRootEl)  melRootEl.addEventListener('change', onKeyOrScaleChange);
    if (melScaleEl) melScaleEl.addEventListener('change', onKeyOrScaleChange);
    if (melBpmEl)   melBpmEl.addEventListener('input', function (e) {
      melBpm = parseInt(e.target.value, 10) || 120;
      if (melBpmVal) melBpmVal.textContent = melBpm + ' bpm';
    });
    if (melClear)   melClear.addEventListener('click', function () {
      melPads = [];
      buildPads();
    });
    if (melLoad)    melLoad.addEventListener('click', commitMelodicTape);

    /* Close pickers on outside click */
    document.addEventListener('click', function (e) {
      if (!e.target.closest('.mel-pad')) closeAllPickers();
    });

    /* Sync hold — K key (with e.repeat guard from original) */
    document.addEventListener('keydown', function (e) {
      if (e.repeat) return;
      if (e.key === 'k' || e.key === 'K') engageSync();
    });
    document.addEventListener('keyup', function (e) {
      if (e.key === 'k' || e.key === 'K') releaseSync();
    });

    /* Sync badge — touch + mouse (from original) */
    var badge = document.getElementById('sync-badge');
    if (badge) {
      badge.addEventListener('touchstart',  function (e) { e.preventDefault(); engageSync(); },  { passive: false });
      badge.addEventListener('touchend',    function (e) { e.preventDefault(); releaseSync(); }, { passive: false });
      badge.addEventListener('mousedown',   function () { engageSync(); });
      badge.addEventListener('mouseup',     function () { releaseSync(); });
      badge.addEventListener('mouseleave',  function () { if (state.synced) releaseSync(); });
    }

    /* Initialise labels */
    var dd = document.getElementById('disp-drift');
    var dv = document.getElementById('pm-drift-val');
    var va = document.getElementById('pm-vol-a-val');
    var vb = document.getElementById('pm-vol-b-val');
    var xv = document.getElementById('pm-crossfade-val');
    if (dd) dd.textContent = '+1.0%';
    if (dv) dv.textContent = '+1.0%';
    if (va) va.textContent = '75%';
    if (vb) vb.textContent = '75%';
    if (xv) xv.textContent = '0 ms';

    hideMelEditor();
    hideMicPanel();
    clearPending();

    /* Load default */
    loadDefault();
  }

  init();

}());
