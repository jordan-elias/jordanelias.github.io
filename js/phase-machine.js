(function () {
  'use strict';

  /* ════════════════════════════════
     AUDIO CONTEXT
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
     DEFAULT LOOP — generated percussion-like pulse
     (a short rhythmic pattern so phasing is immediately audible)
  ════════════════════════════════ */
  function generateDefaultLoop(ctx) {
    /* Create a short rhythmic buffer: 3 impulses in ~1.5 seconds */
    var sr  = ctx.sampleRate;
    var dur = 1.6; /* loop duration in seconds */
    var buf = ctx.createBuffer(1, Math.floor(sr * dur), sr);
    var d   = buf.getChannelData(0);

    /* Impulse positions (in samples): beat at 0, 0.4s, 1.0s */
    var positions = [0, Math.floor(sr * 0.4), Math.floor(sr * 1.0)];
    var envLen    = Math.floor(sr * 0.06); /* 60ms decay */

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

  /* ════════════════════════════════
     STATE
  ════════════════════════════════ */
  var state = {
    buffer:      null,     /* shared AudioBuffer for both tapes */
    playing:     false,
    driftPct:    1.0,      /* percentage faster tape B runs */
    volA:        0.75,
    volB:        0.75,
    synced:      false,    /* true while K is held */
    /* Playback tracking (approximate, using AudioContext clock) */
    startTime:   0,
    offsetA:     0,
    offsetB:     0
  };

  /* Audio nodes */
  var srcA = null, srcB = null;
  var gainA = null, gainB = null;
  var masterGain = null;

  /* For position display */
  var dispTimer = null;

  /* ════════════════════════════════
     PLAYBACK
  ════════════════════════════════ */

  /*
   * Implementation approach:
   * We use two BufferSource nodes, both looping.
   * Tape A: playbackRate = 1.0
   * Tape B: playbackRate = 1 + driftPct/100 (or 1.0 when synced)
   *
   * Both start at time 0 in the buffer.
   * We track their playback positions approximately using AudioContext.currentTime.
   *
   * Sync hold: when K is pressed, we:
   *   1. Note the current approximate position of both tapes
   *   2. Stop both and restart them from those positions at rate 1.0
   *   3. On release, restart with original rates from new positions
   *
   * This is the cleanest approach for Web Audio since AudioBuffer.position
   * is not directly readable — we approximate using elapsed time × playbackRate.
   */

  function rateB() {
    return state.synced ? 1.0 : 1.0 + state.driftPct / 100;
  }

  function currentPosA() {
    if (!state.playing || !state.buffer) return 0;
    var elapsed = getCtx().currentTime - state.startTime;
    var len     = state.buffer.duration;
    return ((state.offsetA + elapsed * 1.0) % len + len) % len;
  }

  function currentPosB() {
    if (!state.playing || !state.buffer) return 0;
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
    srcA.buffer       = state.buffer;
    srcA.loop         = true;
    srcA.playbackRate.value = 1.0;
    srcA.connect(gainA);

    srcB = ctx.createBufferSource();
    srcB.buffer       = state.buffer;
    srcB.loop         = true;
    srcB.playbackRate.value = rateB();
    srcB.connect(gainB);

    /* Start both with correct offset into the loop */
    var loopLen = state.buffer.duration;
    var safeA   = ((posA % loopLen) + loopLen) % loopLen;
    var safeB   = ((posB % loopLen) + loopLen) % loopLen;

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
      startPlayback(0, 0);
      startDisplayTimer();
      setPlayBtn(true);
    }
  }

  function resetMachine() {
    var wasPlaying = state.playing;
    state.playing = false;
    stopNodes();
    stopDisplayTimer();
    state.offsetA = 0;
    state.offsetB = 0;
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
    btn.innerHTML = on ? '&#9632;&#xFE0E; stop' : '&#9654;&#xFE0E; play';
    btn.classList.toggle('on', on);
  }

  /* ════════════════════════════════
     SYNC HOLD (K key)
  ════════════════════════════════ */

  function engageSync() {
    if (state.synced || !state.playing) return;
    /* Capture current approximate positions */
    var pA = currentPosA();
    var pB = currentPosB();
    state.synced = true;
    /* Restart both at current positions, rate 1.0 */
    startPlayback(pA, pB);
    document.getElementById('sync-badge').classList.add('synced');
  }

  function releaseSync() {
    if (!state.synced) return;
    var pA = currentPosA();
    var pB = currentPosB();
    state.synced = false;
    /* Restart with drift restored */
    if (state.playing) startPlayback(pA, pB);
    document.getElementById('sync-badge').classList.remove('synced');
  }

  /* ════════════════════════════════
     DISPLAY
  ════════════════════════════════ */

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
  }

  function updateDisplay(pA, pB) {
    var len    = state.buffer ? state.buffer.duration : 1;
    var offset = ((pB - pA) % len + len) % len;
    var pct    = len > 0 ? (offset / len) * 100 : 0;

    document.getElementById('disp-a').textContent      = pA.toFixed(3) + ' s';
    document.getElementById('disp-b').textContent      = pB.toFixed(3) + ' s';
    document.getElementById('disp-offset').textContent = offset.toFixed(3) + ' s';
    document.getElementById('phase-bar').style.width   = pct.toFixed(1) + '%';
  }

  /* ════════════════════════════════
     SOURCE LOADING
  ════════════════════════════════ */

  function loadBuffer(buf, label) {
    /* Normalise */
    var d = buf.getChannelData(0), peak = 0;
    for (var i = 0; i < d.length; i++) { var a = Math.abs(d[i]); if (a > peak) peak = a; }
    if (peak > 0.001) { var s = 0.78 / peak; for (var i = 0; i < d.length; i++) d[i] *= s; }

    var wasPlaying = state.playing;
    state.playing = false;
    stopNodes();
    stopDisplayTimer();

    state.buffer  = buf;
    state.offsetA = 0;
    state.offsetB = 0;

    document.getElementById('pm-play').disabled = false;
    setPlayBtn(false);
    if (label) setStatus(label);
    updateDisplay(0, 0);
  }

  function loadDefault() {
    setSrcUI('default');
    var buf = generateDefaultLoop(getCtx());
    loadBuffer(buf, 'default loop ready');
  }

  function loadFile(file) {
    setSrcUI('file');
    setStatus('loading…');
    var r = new FileReader();
    r.onload = function (e) {
      getCtx().decodeAudioData(e.target.result, function (decoded) {
        loadBuffer(decoded, 'loaded: ' + file.name.substring(0, 28));
      }, function () {
        setStatus('could not decode file');
      });
    };
    r.readAsArrayBuffer(file);
  }

  /* Mic */
  var mediaRec    = null;
  var recChunks   = [];
  var isRecording = false;
  var hasRec      = false;

  function startRec() {
    if (isRecording) { stopRec(); return; }
    navigator.mediaDevices.getUserMedia({ audio: true, video: false }).then(function (stream) {
      recChunks = [];
      mediaRec  = new MediaRecorder(stream);
      mediaRec.ondataavailable = function (e) { if (e.data.size > 0) recChunks.push(e.data); };
      mediaRec.onstop = function () {
        stream.getTracks().forEach(function (t) { t.stop(); });
        var blob = new Blob(recChunks, { type: 'audio/webm' });
        var fr   = new FileReader();
        fr.onload = function (ev) {
          getCtx().decodeAudioData(ev.target.result, function (decoded) {
            isRecording = false; hasRec = true;
            loadBuffer(decoded, 'recording ready');
            setRecUI('has_rec');
          }, function () { setStatus('decode failed'); });
        };
        fr.readAsArrayBuffer(blob);
      };
      mediaRec.start();
      isRecording = true;
      setRecUI('recording');
      setStatus('recording… (max 6s)');
      setTimeout(function () { if (isRecording) stopRec(); }, 6000);
    }).catch(function () { setStatus('mic access denied'); });
  }

  function stopRec() { if (mediaRec && isRecording) mediaRec.stop(); }

  function setRecUI(s) {
    var rb = document.getElementById('pm-record');
    var sl = document.getElementById('pm-rec-state');
    var nb = document.getElementById('pm-rec-new');
    if (s === 'idle') {
      rb.innerHTML = '&#9679;&#xFE0E; record'; rb.classList.remove('on'); rb.style.display = 'inline-block';
      sl.style.display = 'none'; nb.style.display = 'none';
    } else if (s === 'recording') {
      rb.innerHTML = '&#9632;&#xFE0E; stop'; rb.classList.add('on'); rb.style.display = 'inline-block';
      sl.style.display = 'none'; nb.style.display = 'none';
    } else if (s === 'has_rec') {
      rb.style.display = 'none';
      sl.textContent = 'using recording'; sl.style.display = 'inline';
      nb.style.display = 'inline-block';
    }
  }

  function setSrcUI(type) {
    document.getElementById('src-default').classList.toggle('on',    type === 'default');
    document.getElementById('src-mic').classList.toggle('on',        type === 'mic');
    document.getElementById('pm-upload-label').classList.toggle('on', type === 'file');
    var showMic = (type === 'mic');
    document.getElementById('pm-record').style.display    = showMic && !hasRec ? 'inline-block' : 'none';
    document.getElementById('pm-rec-state').style.display = showMic && hasRec  ? 'inline'        : 'none';
    document.getElementById('pm-rec-new').style.display   = showMic && hasRec  ? 'inline-block'  : 'none';
    if (showMic && !hasRec) setRecUI('idle');
  }

  function setStatus(msg) {
    /* Use the drift display as a status line when idle */
    if (!state.playing) {
      document.getElementById('disp-drift').textContent = msg;
    }
  }

  /* ════════════════════════════════
     INIT
  ════════════════════════════════ */
  function init() {

    /* Source buttons */
    document.getElementById('src-default').addEventListener('click', loadDefault);

    document.getElementById('src-mic').addEventListener('click', function () {
      hasRec = false;
      setSrcUI('mic');
      var wasPlaying = state.playing;
      state.playing = false;
      stopNodes();
      stopDisplayTimer();
      state.buffer = null;
      document.getElementById('pm-play').disabled = true;
      setRecUI('idle');
      setStatus('press record and speak');
    });

    document.getElementById('pm-file-input').addEventListener('change', function (e) {
      if (e.target.files && e.target.files[0]) loadFile(e.target.files[0]);
    });

    document.getElementById('pm-record').addEventListener('click', startRec);

    document.getElementById('pm-rec-new').addEventListener('click', function () {
      hasRec = false;
      state.playing = false;
      stopNodes();
      stopDisplayTimer();
      state.buffer = null;
      document.getElementById('pm-play').disabled = true;
      setRecUI('idle');
      setStatus('press record and speak');
    });

    /* Transport */
    document.getElementById('pm-play').addEventListener('click', togglePlay);
    document.getElementById('pm-reset').addEventListener('click', resetMachine);

    /* Drift slider */
    document.getElementById('pm-drift').addEventListener('input', function (e) {
      state.driftPct = parseFloat(e.target.value);
      var label = '+' + state.driftPct.toFixed(1) + '%';
      document.getElementById('pm-drift-val').textContent  = label;
      document.getElementById('disp-drift').textContent    = label;
      /* Apply live if playing and not synced */
      if (state.playing && !state.synced && srcB) {
        srcB.playbackRate.setValueAtTime(rateB(), getCtx().currentTime);
      }
    });

    /* Volume sliders */
    document.getElementById('pm-vol-a').addEventListener('input', function (e) {
      state.volA = parseFloat(e.target.value);
      document.getElementById('pm-vol-a-val').textContent = Math.round(state.volA * 100) + '%';
      if (gainA) gainA.gain.setValueAtTime(state.volA, getCtx().currentTime);
    });

    document.getElementById('pm-vol-b').addEventListener('input', function (e) {
      state.volB = parseFloat(e.target.value);
      document.getElementById('pm-vol-b-val').textContent = Math.round(state.volB * 100) + '%';
      if (gainB) gainB.gain.setValueAtTime(state.volB, getCtx().currentTime);
    });

    /* Sync hold key — K */
    document.addEventListener('keydown', function (e) {
      if (e.repeat) return;
      if (e.key === 'k' || e.key === 'K') engageSync();
    });

    document.addEventListener('keyup', function (e) {
      if (e.key === 'k' || e.key === 'K') releaseSync();
    });

    /* Mobile touch on sync badge */
    var badge = document.getElementById('sync-badge');
    badge.addEventListener('touchstart', function (e) {
      e.preventDefault(); engageSync();
    }, { passive: false });
    badge.addEventListener('touchend', function (e) {
      e.preventDefault(); releaseSync();
    }, { passive: false });
    badge.addEventListener('mousedown', function () { engageSync(); });
    badge.addEventListener('mouseup',   function () { releaseSync(); });
    badge.addEventListener('mouseleave',function () { if (state.synced) releaseSync(); });

    /* Init with default loop */
    loadDefault();

    /* Update drift label */
    document.getElementById('disp-drift').textContent = '+' + state.driftPct.toFixed(1) + '%';
  }

  init();

}());
