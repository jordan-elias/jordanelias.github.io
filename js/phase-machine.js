/* phase-machine.js — phase machine with melodic sequencer
   Core playback engine based on original implementation.
   Melodic sequencer mode added.
*/
(function () {
  'use strict';

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
  var melBpm    = 120;
  var melActiveA = -1;
  var melActiveB = -1;

  /* Mic */
  var mediaRec    = null;
  var recChunks   = [];
  var isRecording = false;
  var hasRec      = false;
  var micBuffer   = null;

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
    btn.innerHTML = on ? '&#9632;&#xFE0E; stop' : '&#9654;&#xFE0E; play';
    btn.classList.toggle('on', on);
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
     BUFFER LOADING (shared final step for all sources)
  ════════════════════════════════════════════════════════════ */

  function loadBuffer(buf, label) {
    /* Normalise peak to 0.78 */
    var ch   = buf.getChannelData(0);
    var peak = 0;
    for (var i = 0; i < ch.length; i++) { var a = Math.abs(ch[i]); if (a > peak) peak = a; }
    if (peak > 0.001) {
      var sc = 0.78 / peak;
      for (var c = 0; c < buf.numberOfChannels; c++) {
        var data = buf.getChannelData(c);
        for (var j = 0; j < data.length; j++) data[j] *= sc;
      }
    }

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
     SOURCE: DEFAULT
  ════════════════════════════════════════════════════════════ */
  function loadDefault() {
    currentMode = MODE.DEFAULT;
    setSrcUI('default');
    hideMelEditor();
    hideMicPanel();
    loadBuffer(generateDefaultLoop(resumeCtx()), 'default loop loaded');
  }

  /* ════════════════════════════════════════════════════════════
     SOURCE: FILE UPLOAD
  ════════════════════════════════════════════════════════════ */
  function loadFile(file) {
    currentMode = MODE.UPLOAD;
    setSrcUI('file');
    setTapeStatus('loading…', false);
    var r = new FileReader();
    r.onload = function (e) {
      resumeCtx().decodeAudioData(e.target.result, function (decoded) {
        hideMelEditor();
        hideMicPanel();
        loadBuffer(decoded, 'loaded: ' + file.name.substring(0, 28));
      }, function () {
        setTapeStatus('could not decode file', true);
      });
    };
    r.readAsArrayBuffer(file);
  }

  /* ════════════════════════════════════════════════════════════
     SOURCE: MICROPHONE
  ════════════════════════════════════════════════════════════ */
  function activateMicMode() {
    currentMode = MODE.MIC;
    hasRec      = false;
    micBuffer   = null;
    setSrcUI('mic');
    hideMelEditor();
    showMicPanel();
    state.playing = false;
    stopNodes();
    stopDisplayTimer();
    state.buffer = null;
    var playBtn = document.getElementById('pm-play');
    if (playBtn) playBtn.disabled = true;
    setPlayBtn(false);
    setTapeStatus('press record, then load tape →', false);
    setRecUI('idle');
  }

  function startRec() {
    if (isRecording) { stopRec(); return; }
    navigator.mediaDevices.getUserMedia({ audio: true, video: false })
      .then(function (stream) {
        recChunks = [];
        mediaRec  = new MediaRecorder(stream);
        mediaRec.ondataavailable = function (e) { if (e.data.size > 0) recChunks.push(e.data); };
        mediaRec.onstop = function () {
          stream.getTracks().forEach(function (t) { t.stop(); });
          var blob = new Blob(recChunks, { type: 'audio/webm' });
          var fr   = new FileReader();
          fr.onload = function (ev) {
            resumeCtx().decodeAudioData(ev.target.result, function (decoded) {
              isRecording = false;
              hasRec      = true;
              micBuffer   = decoded;
              setRecUI('has_rec');
              setTapeStatus('recording ready — load tape →', false);
              var lt = document.getElementById('load-tape-btn');
              if (lt) { lt.style.display = 'inline-block'; lt.disabled = false; }
            }, function () { setTapeStatus('decode failed', true); });
          };
          fr.readAsArrayBuffer(blob);
        };
        mediaRec.start();
        isRecording = true;
        setRecUI('recording');
        setTapeStatus('recording… (max 6s)', false);
        /* Auto-stop after 6 seconds — preserved from original */
        setTimeout(function () { if (isRecording) stopRec(); }, 6000);
      })
      .catch(function () { setTapeStatus('mic access denied', true); });
  }

  function stopRec() {
    if (mediaRec && isRecording) mediaRec.stop();
  }

  function commitMicTape() {
    if (!micBuffer) { setTapeStatus('nothing recorded yet', true); return; }
    hideMicPanel();
    loadBuffer(micBuffer, 'microphone recording');
  }

  function setRecUI(s) {
    var rb = document.getElementById('pm-record');
    var sl = document.getElementById('pm-rec-state');
    var nb = document.getElementById('pm-rec-new');
    if (!rb) return;
    if (s === 'idle') {
      rb.innerHTML = '&#9679;&#xFE0E; record'; rb.classList.remove('on');
      rb.style.display = 'inline-block';
      if (sl) sl.style.display = 'none';
      if (nb) nb.style.display = 'none';
    } else if (s === 'recording') {
      rb.innerHTML = '&#9632;&#xFE0E; stop'; rb.classList.add('on');
      rb.style.display = 'inline-block';
      if (sl) sl.style.display = 'none';
      if (nb) nb.style.display = 'none';
    } else if (s === 'has_rec') {
      rb.style.display = 'none';
      if (sl) { sl.textContent = 'recorded ✓'; sl.style.display = 'inline'; }
      if (nb) nb.style.display = 'inline-block';
    }
  }

  function showMicPanel() {
    var rb = document.getElementById('pm-record');
    var rs = document.getElementById('pm-rec-state');
    var lt = document.getElementById('load-tape-btn');
    if (rb) rb.style.display = 'inline-block';
    if (rs) rs.style.display = 'none';
    if (lt) { lt.style.display = 'inline-block'; lt.disabled = true; }
  }

  function hideMicPanel() {
    var rb = document.getElementById('pm-record');
    var rs = document.getElementById('pm-rec-state');
    var rn = document.getElementById('pm-rec-new');
    var lt = document.getElementById('load-tape-btn');
    if (rb) rb.style.display = 'none';
    if (rs) rs.style.display = 'none';
    if (rn) rn.style.display = 'none';
    if (lt) lt.style.display = 'none';
  }

  /* ════════════════════════════════════════════════════════════
     SOURCE: MELODIC
  ════════════════════════════════════════════════════════════ */
  function activateMelodicMode() {
    currentMode = MODE.MELODIC;
    setSrcUI('melodic');
    hideMicPanel();
    showMelEditor();
    setTapeStatus('build your sequence, then load tape →', false);
  }

  function commitMelodicTape() {
    var result = renderMelodicBuffer(melPads, melBpm);
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

    /* Click: toggle picker */
    pad.addEventListener('click', function (e) {
      if (e.target.closest('.note-picker')) return;
      var isOpen = picker.classList.contains('visible');
      closeAllPickers();
      if (!isOpen) picker.classList.add('visible');
    });

    /* Hover: open after short delay */
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

    if (srcDefault)  srcDefault.addEventListener('click', loadDefault);
    if (srcMic)      srcMic.addEventListener('click', activateMicMode);
    if (srcMelodic)  srcMelodic.addEventListener('click', activateMelodicMode);
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
      hasRec      = false;
      micBuffer   = null;
      isRecording = false;
      state.buffer = null;
      var pb = document.getElementById('pm-play');
      if (pb) pb.disabled = true;
      setPlayBtn(false);
      setRecUI('idle');
      var lt = document.getElementById('load-tape-btn');
      if (lt) lt.disabled = true;
      setTapeStatus('press record, then load tape →', false);
    });
    if (loadBtn) loadBtn.addEventListener('click', commitMicTape);

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
    var melClear   = document.getElementById('mel-clear');
    var melLoad    = document.getElementById('mel-load');

    if (melStepsEl) melStepsEl.addEventListener('change', buildPads);
    if (melRootEl)  melRootEl.addEventListener('change', onKeyOrScaleChange);
    if (melScaleEl) melScaleEl.addEventListener('change', onKeyOrScaleChange);
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
    if (dd) dd.textContent = '+1.0%';
    if (dv) dv.textContent = '+1.0%';
    if (va) va.textContent = '75%';
    if (vb) vb.textContent = '75%';

    hideMelEditor();
    hideMicPanel();

    /* Load default */
    loadDefault();
  }

  init();

}());
