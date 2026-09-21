/* soundscape-machine.js
   Four-track tape manipulation lab, inspired by Delia Derbyshire.
   Lite / stateless build: no accounts, no persistence. Record or upload
   per track, shape with speed / filter / ring modulator / LFO / reverb,
   then render an offline WAV bounce for download.
*/
(function () {
  'use strict';

  /* ════════════════════════════════════════════════════════════
     CONSTANTS
  ════════════════════════════════════════════════════════════ */
  var N_TRACKS       = 4;
  var TRACK_NAMES    = ['Track 1', 'Track 2', 'Track 3', 'Track 4'];
  var BASE_FREQ      = 220;       // abstract reference frequency for ratio/interval math
  var MAX_REC_SEC    = 30;        // microphone recording cap
  var MAX_UPLOAD_SEC = 120;       // uploaded file cap (auto-trimmed to first N seconds)

  var SPEED_SNAPS      = [0.25, 0.5, 2 / 3, 0.75, 1.0, 4 / 3, 1.5, 2.0, 4.0];
  var SNAP_THRESH_LOG2 = 0.04;

  var INTERVAL_NAMES = ['unison','m2','M2','m3','M3','P4','tritone','P5','m6','M6','m7','M7','P8'];

  /* ════════════════════════════════════════════════════════════
     AUDIO CONTEXT
  ════════════════════════════════════════════════════════════ */
  var AC = null, masterGain = null;
  var reverbIR = null;

  function getCtx() {
    if (!AC) AC = new (window.AudioContext || window.webkitAudioContext)();
    return AC;
  }
  function resumeCtx() {
    var ctx = getCtx();
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }
  function ensureMaster() {
    if (masterGain) return;
    var ctx = resumeCtx();
    masterGain = ctx.createGain();
    masterGain.gain.value = 0.8;
    masterGain.connect(ctx.destination);
  }

  function makeReverbImpulse(ctx) {
    var len = Math.floor(ctx.sampleRate * 2.6);
    var buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (var c = 0; c < 2; c++) {
      var d = buf.getChannelData(c);
      for (var i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.2);
    }
    return buf;
  }

  /* ════════════════════════════════════════════════════════════
     STATE
  ════════════════════════════════════════════════════════════ */
  var isPlaying = false, wallStart = 0, timerRaf = null;
  var ratioLocked = false;
  var isTouchDevice = (('ontouchstart' in window) || (navigator.maxTouchPoints > 0));

  var tracks = Array.from({ length: N_TRACKS }, function (_, i) {
    return {
      id: i, name: TRACK_NAMES[i],
      buffer: null, fileName: null,
      speed: 1.0, loop: true, crossfade: 0,
      filterType: 'lowpass', filterFreq: 8000, filterQ: 0.7,
      ringEnabled: false, ringCarrier: 150,
      reverbEnabled: false, reverbAmount: 0.3,
      lfoEnabled: false, lfoRate: 0.5, lfoShape: 'sine', lfoTarget: 'filter',
      volume: 0.75, pan: 0, muted: false, soloed: false,
      ratioNum: (i === 0 ? 1 : i + 1), ratioDen: 1,
      playheadPct: 0,
      // nodes
      sourceNode: null, filterNode: null, gainNode: null, panNode: null,
      dryGain: null, reverbGain: null, reverbNode: null,
      lfoOsc: null, lfoGain: null,
      ringOsc: null, ringWet: null, ringDry: null,
      _ringSum: null, _ringDiff: null, _ringSqSum: null, _ringSqDiff: null, _ringInv: null, _ringOut: null,
      // recording
      mediaRec: null, recChunks: [], isRecording: false, recTimeout: null,
    };
  });

  /* ════════════════════════════════════════════════════════════
     RING MODULATOR   A*B = ((A+B)^2 - (A-B)^2) / 4
  ════════════════════════════════════════════════════════════ */
  function makeSquaringCurve(ctx, n) {
    n = n || 4096;
    var curve = new Float32Array(n);
    for (var i = 0; i < n; i++) { var x = (i * 2) / n - 1; curve[i] = x * x; }
    return curve;
  }

  function buildRingMod(ctx, t, sourceNode) {
    var ringOsc = ctx.createOscillator();
    ringOsc.type = 'sine'; ringOsc.frequency.value = t.ringCarrier; ringOsc.start();

    var sumGain = ctx.createGain(); sumGain.gain.value = 1;
    sourceNode.connect(sumGain); ringOsc.connect(sumGain);

    var invGain = ctx.createGain(); invGain.gain.value = -1;
    ringOsc.connect(invGain);
    var diffGain = ctx.createGain(); diffGain.gain.value = 1;
    sourceNode.connect(diffGain); invGain.connect(diffGain);

    var sqSum  = ctx.createWaveShaper(); sqSum.curve  = makeSquaringCurve(ctx); sqSum.oversample  = '4x';
    var sqDiff = ctx.createWaveShaper(); sqDiff.curve = makeSquaringCurve(ctx); sqDiff.oversample = '4x';
    sumGain.connect(sqSum); diffGain.connect(sqDiff);

    var negDiff = ctx.createGain(); negDiff.gain.value = -1; sqDiff.connect(negDiff);
    var ringOut = ctx.createGain(); ringOut.gain.value = 0.25;
    sqSum.connect(ringOut); negDiff.connect(ringOut);

    var ringWet = ctx.createGain(); ringWet.gain.value = t.ringEnabled ? 1 : 0;
    var ringDry = ctx.createGain(); ringDry.gain.value = t.ringEnabled ? 0 : 1;
    ringOut.connect(ringWet); sourceNode.connect(ringDry);

    t.ringOsc = ringOsc; t.ringWet = ringWet; t.ringDry = ringDry;
    t._ringSum = sumGain; t._ringDiff = diffGain; t._ringSqSum = sqSum; t._ringSqDiff = sqDiff;
    t._ringInv = invGain; t._ringOut = ringOut;

    var merger = ctx.createGain(); merger.gain.value = 1;
    ringWet.connect(merger); ringDry.connect(merger);
    return merger;
  }

  /* ════════════════════════════════════════════════════════════
     CROSSFADE (for seamless loops)
  ════════════════════════════════════════════════════════════ */
  function applyCrossfadeToBuffer(ctx, buffer, fadeMs) {
    if (!buffer || fadeMs <= 0) return buffer;
    var fadeSamples = Math.floor((fadeMs / 1000) * buffer.sampleRate);
    if (fadeSamples >= buffer.length / 2) return buffer;
    var numCh = buffer.numberOfChannels, len = buffer.length;
    var out = ctx.createBuffer(numCh, len, buffer.sampleRate);
    for (var c = 0; c < numCh; c++) {
      var inData = buffer.getChannelData(c), outData = out.getChannelData(c);
      outData.set(inData);
      for (var i = 0; i < fadeSamples; i++) {
        var fi = i / fadeSamples, fo = 1 - fi;
        var si = i, ei = len - fadeSamples + i;
        outData[si] = inData[si] * fi + inData[ei] * fo;
        outData[ei] = inData[ei] * fo + inData[si] * fi;
      }
    }
    return out;
  }

  /* ════════════════════════════════════════════════════════════
     LFO helpers
  ════════════════════════════════════════════════════════════ */
  function getLfoDepth(t) {
    if (t.lfoTarget === 'filter') return t.filterFreq * 0.5;
    if (t.lfoTarget === 'volume') return t.volume * 0.6;
    if (t.lfoTarget === 'pan')    return 0.8;
    if (t.lfoTarget === 'ring')   return t.ringCarrier * 0.5;
    return 0;
  }
  function connectLfoTarget(t, lfoGain, gainNode, panNode, filterNode) {
    if (t.lfoTarget === 'filter') lfoGain.connect(filterNode.frequency);
    else if (t.lfoTarget === 'volume') lfoGain.connect(gainNode.gain);
    else if (t.lfoTarget === 'pan') lfoGain.connect(panNode.pan);
    else if (t.lfoTarget === 'ring' && t.ringOsc) lfoGain.connect(t.ringOsc.frequency);
  }

  function computeEffectiveGain(t) {
    var anySoloed = tracks.some(function (tr) { return tr.soloed; });
    if (t.muted) return 0;
    if (anySoloed && !t.soloed) return 0;
    return t.volume;
  }

  /* ════════════════════════════════════════════════════════════
     LIVE TRACK GRAPH
  ════════════════════════════════════════════════════════════ */
  function buildTrackGraph(t) {
    ensureMaster();
    var ctx = getCtx();
    teardownTrackGraph(t);
    if (!t.buffer) return;

    var buf = (t.loop && t.crossfade > 0) ? applyCrossfadeToBuffer(ctx, t.buffer, t.crossfade) : t.buffer;
    var src = ctx.createBufferSource();
    src.buffer = buf; src.playbackRate.value = t.speed; src.loop = t.loop;
    t.sourceNode = src;

    var filterNode = ctx.createBiquadFilter();
    filterNode.type = t.filterType; filterNode.frequency.value = t.filterFreq; filterNode.Q.value = t.filterQ;
    t.filterNode = filterNode;

    var lfoOsc = ctx.createOscillator(), lfoGain = ctx.createGain();
    lfoOsc.type = t.lfoShape; lfoOsc.frequency.value = t.lfoRate;
    lfoGain.gain.value = t.lfoEnabled ? getLfoDepth(t) : 0;
    lfoOsc.connect(lfoGain); lfoOsc.start();
    t.lfoOsc = lfoOsc; t.lfoGain = lfoGain;

    var gainNode = ctx.createGain(); gainNode.gain.value = computeEffectiveGain(t);
    var panNode = ctx.createStereoPanner(); panNode.pan.value = t.pan;
    t.gainNode = gainNode; t.panNode = panNode;

    var dryGain = ctx.createGain(), reverbGain = ctx.createGain(), convolver = ctx.createConvolver();
    if (reverbIR) convolver.buffer = reverbIR;
    dryGain.gain.value = t.reverbEnabled ? 1 - t.reverbAmount : 1;
    reverbGain.gain.value = t.reverbEnabled ? t.reverbAmount : 0;
    t.dryGain = dryGain; t.reverbGain = reverbGain; t.reverbNode = convolver;

    connectLfoTarget(t, lfoGain, gainNode, panNode, filterNode);

    src.connect(filterNode);
    var ringMerge = buildRingMod(ctx, t, filterNode);
    ringMerge.connect(gainNode);
    gainNode.connect(panNode);
    panNode.connect(dryGain); panNode.connect(convolver);
    dryGain.connect(masterGain); convolver.connect(reverbGain); reverbGain.connect(masterGain);
  }

  function teardownTrackGraph(t) {
    var tryStop = function (n) { try { n && n.stop(); } catch (e) {} };
    var tryDC   = function (n) { try { n && n.disconnect(); } catch (e) {} };
    [t.sourceNode, t.lfoOsc, t.ringOsc].forEach(tryStop);
    ['sourceNode','filterNode','gainNode','panNode','dryGain','reverbGain','reverbNode',
     'lfoOsc','lfoGain','ringOsc','ringWet','ringDry',
     '_ringSum','_ringDiff','_ringSqSum','_ringSqDiff','_ringInv','_ringOut'
    ].forEach(function (k) { tryDC(t[k]); t[k] = null; });
  }

  /* ════════════════════════════════════════════════════════════
     MUTE / SOLO
  ════════════════════════════════════════════════════════════ */
  function setMute(id) {
    var t = tracks[id]; t.muted = !t.muted; if (t.muted) t.soloed = false;
    applyMuteSolo(); renderMuteSoloUI();
  }
  function setSolo(id) {
    var t = tracks[id]; var was = t.soloed;
    tracks.forEach(function (tr) { tr.soloed = false; });
    if (!was) t.soloed = true;
    applyMuteSolo(); renderMuteSoloUI();
  }
  function applyMuteSolo() {
    tracks.forEach(function (t) {
      if (t.gainNode) t.gainNode.gain.setTargetAtTime(computeEffectiveGain(t), getCtx().currentTime, 0.04);
    });
  }
  function renderMuteSoloUI() {
    tracks.forEach(function (t) {
      var mb = document.getElementById('mute-' + t.id), sb = document.getElementById('solo-' + t.id);
      var el = document.getElementById('track-' + t.id);
      if (mb) mb.classList.toggle('on', t.muted);
      if (sb) sb.classList.toggle('on', t.soloed);
      if (el) { el.classList.toggle('is-muted', t.muted); el.classList.toggle('is-soloed', t.soloed); }
    });
  }

  /* ════════════════════════════════════════════════════════════
     TRANSPORT
  ════════════════════════════════════════════════════════════ */
  function transportPlay() {
    ensureMaster();
    if (getCtx().state === 'suspended') getCtx().resume();
    if (isPlaying) return;
    if (!tracks.some(function (t) { return t.buffer; })) return;
    isPlaying = true; wallStart = performance.now();
    tracks.forEach(function (t) {
      if (!t.buffer) return;
      buildTrackGraph(t);
      if (t.sourceNode) t.sourceNode.start(0);
    });
    updateTransportUI(true);
    timerRaf = requestAnimationFrame(transportTick);
  }

  function transportStop() {
    if (!isPlaying) return;
    isPlaying = false; cancelAnimationFrame(timerRaf);
    tracks.forEach(function (t) { teardownTrackGraph(t); t.playheadPct = 0; drawWaveform(t); });
    var timeEl = document.getElementById('ss-time'); if (timeEl) timeEl.textContent = '0:00.0';
    updateTransportUI(false);
  }

  function transportTick() {
    if (!isPlaying) return;
    var elapsed = (performance.now() - wallStart) / 1000;
    var m = Math.floor(elapsed / 60), s = (elapsed % 60).toFixed(1);
    var timeEl = document.getElementById('ss-time');
    if (timeEl) timeEl.textContent = m + ':' + s.padStart(4, '0');
    tracks.forEach(function (t) {
      if (!t.buffer || !t.sourceNode) return;
      var dur = t.buffer.duration / t.speed;
      t.playheadPct = t.loop ? (elapsed % dur) / dur : Math.min(elapsed / dur, 1);
      drawWaveform(t);
    });
    timerRaf = requestAnimationFrame(transportTick);
  }

  function updateTransportUI(playing) {
    var playBtn = document.getElementById('ss-play'), stopBtn = document.getElementById('ss-stop');
    if (playBtn) playBtn.disabled = playing || !tracks.some(function (t) { return t.buffer; });
    if (stopBtn) stopBtn.disabled = !playing;
  }

  /* ════════════════════════════════════════════════════════════
     WAVEFORM DRAW
  ════════════════════════════════════════════════════════════ */
  function drawWaveform(t) {
    var canvas = document.getElementById('wave-' + t.id); if (!canvas) return;
    var ctx = canvas.getContext('2d'), dpr = window.devicePixelRatio || 1;
    canvas.width = canvas.offsetWidth * dpr; canvas.height = 42 * dpr;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!t.buffer) {
      ctx.fillStyle = 'rgba(128,128,128,0.35)';
      ctx.fillRect(0, canvas.height / 2 - 1, canvas.width, 2);
      return;
    }
    var data = t.buffer.getChannelData(0), W = canvas.width, H = canvas.height;
    var step = Math.ceil(data.length / W);
    var textColor = getComputedStyle(document.body).getPropertyValue('--text').trim() || '#1a1a1a';
    ctx.fillStyle = textColor; ctx.globalAlpha = 0.18;
    ctx.strokeStyle = textColor; ctx.lineWidth = 1; ctx.globalAlpha = 1;
    for (var x = 0; x < W; x++) {
      var max = 0, min = 0;
      for (var j = 0; j < step; j++) { var sIdx = x * step + j; var v = data[sIdx] || 0; if (v > max) max = v; if (v < min) min = v; }
      var y1 = (1 - max) * H / 2, y2 = (1 - min) * H / 2;
      ctx.globalAlpha = 0.25; ctx.fillRect(x, y1, 1, Math.max(1, y2 - y1));
    }
    if (isPlaying && t.sourceNode) {
      ctx.globalAlpha = 0.9; ctx.lineWidth = 2 * dpr;
      ctx.beginPath(); ctx.moveTo(t.playheadPct * W, 0); ctx.lineTo(t.playheadPct * W, H); ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  /* ════════════════════════════════════════════════════════════
     BUFFER LOADING (record / upload, shared final step)
  ════════════════════════════════════════════════════════════ */
  function trimBuffer(ctx, buffer, maxSec) {
    if (buffer.duration <= maxSec) return buffer;
    var frames = Math.floor(maxSec * buffer.sampleRate);
    var out = ctx.createBuffer(buffer.numberOfChannels, frames, buffer.sampleRate);
    for (var c = 0; c < buffer.numberOfChannels; c++) {
      out.getChannelData(c).set(buffer.getChannelData(c).subarray(0, frames));
    }
    return out;
  }

  function normalizeBuffer(buffer) {
    var ch = buffer.getChannelData(0), peak = 0;
    for (var i = 0; i < ch.length; i++) { var a = Math.abs(ch[i]); if (a > peak) peak = a; }
    if (peak > 0.001) {
      var sc = 0.85 / peak;
      for (var c = 0; c < buffer.numberOfChannels; c++) {
        var data = buffer.getChannelData(c);
        for (var j = 0; j < data.length; j++) data[j] *= sc;
      }
    }
    return buffer;
  }

  function loadBufferIntoTrack(id, buffer, label) {
    var t = tracks[id];
    normalizeBuffer(buffer);
    if (isPlaying) { teardownTrackGraph(t); }
    t.buffer = buffer; t.fileName = label;
    setTrackStatus(id, label, true);
    drawWaveform(t);
    var fileInfo = document.getElementById('tfile-' + id);
    if (fileInfo) fileInfo.textContent = label;
    updatePlayBtnAvailability();
    updateRingFreqDisplay(id);
  }

  function setTrackStatus(id, msg, fade) {
    var el = document.getElementById('tstatus-' + id); if (!el) return;
    el.textContent = msg; el.style.opacity = '1';
    clearTimeout(el._fadeTimer);
    if (fade) el._fadeTimer = setTimeout(function () { el.style.opacity = '0'; }, 2400);
  }

  function updatePlayBtnAvailability() {
    var playBtn = document.getElementById('ss-play');
    var dlBtn = document.getElementById('ss-download-btn');
    var hasAny = tracks.some(function (t) { return t.buffer; });
    if (playBtn) playBtn.disabled = !hasAny || isPlaying;
    if (dlBtn) dlBtn.disabled = !hasAny;
  }

  /* ════════════════════════════════════════════════════════════
     UPLOAD
  ════════════════════════════════════════════════════════════ */
  function handleUpload(id, file) {
    setTrackStatus(id, 'loading…', false);
    var reader = new FileReader();
    reader.onload = function (e) {
      resumeCtx().decodeAudioData(e.target.result, function (decoded) {
        var trimmed = trimBuffer(getCtx(), decoded, MAX_UPLOAD_SEC);
        loadBufferIntoTrack(id, trimmed, 'loaded: ' + file.name.substring(0, 26));
      }, function () {
        setTrackStatus(id, 'could not decode file', true);
      });
    };
    reader.readAsArrayBuffer(file);
  }

  /* ════════════════════════════════════════════════════════════
     RECORD
  ════════════════════════════════════════════════════════════ */
  function toggleRecord(id) {
    var t = tracks[id];
    if (t.isRecording) { stopRecord(id); return; }
    navigator.mediaDevices.getUserMedia({ audio: true, video: false })
      .then(function (stream) {
        t.recChunks = [];
        t.mediaRec = new MediaRecorder(stream);
        t.mediaRec.ondataavailable = function (e) { if (e.data.size > 0) t.recChunks.push(e.data); };
        t.mediaRec.onstop = function () {
          stream.getTracks().forEach(function (tr) { tr.stop(); });
          var blob = new Blob(t.recChunks, { type: 'audio/webm' });
          var fr = new FileReader();
          fr.onload = function (ev) {
            resumeCtx().decodeAudioData(ev.target.result, function (decoded) {
              t.isRecording = false; setRecordBtnUI(id, false);
              loadBufferIntoTrack(id, decoded, 'microphone recording');
            }, function () { setTrackStatus(id, 'decode failed', true); });
          };
          fr.readAsArrayBuffer(blob);
        };
        t.mediaRec.start();
        t.isRecording = true; setRecordBtnUI(id, true);
        setTrackStatus(id, 'recording… (max ' + MAX_REC_SEC + 's)', false);
        t.recTimeout = setTimeout(function () { if (t.isRecording) stopRecord(id); }, MAX_REC_SEC * 1000);
      })
      .catch(function () { setTrackStatus(id, 'microphone access denied', true); });
  }
  function stopRecord(id) {
    var t = tracks[id];
    if (t.recTimeout) { clearTimeout(t.recTimeout); t.recTimeout = null; }
    if (t.mediaRec && t.isRecording) t.mediaRec.stop();
  }
  function setRecordBtnUI(id, recording) {
    var btn = document.getElementById('rec-' + id); if (!btn) return;
    btn.innerHTML = recording ? '&#9679;&#xFE0E; stop' : '&#9679;&#xFE0E; record';
    btn.classList.toggle('on', recording);
  }

  /* ════════════════════════════════════════════════════════════
     TRACK PARAM SETTERS
  ════════════════════════════════════════════════════════════ */
  function setTrackParam(id, param, value) {
    var t = tracks[id]; t[param] = value;
    if (!t.gainNode) return;
    if (param === 'volume') t.gainNode.gain.setTargetAtTime(computeEffectiveGain(t), getCtx().currentTime, 0.05);
    if (param === 'pan' && t.panNode) t.panNode.pan.setTargetAtTime(value, getCtx().currentTime, 0.05);
    if (param === 'speed' && t.sourceNode) {
      t.sourceNode.playbackRate.setTargetAtTime(value, getCtx().currentTime, 0.05);
      if (ratioLocked && id === 0) applyRatiosFromTrack0Speed(value);
    }
    if (param === 'loop' && t.sourceNode) t.sourceNode.loop = value;
    if (param === 'filterFreq' && t.filterNode) t.filterNode.frequency.setTargetAtTime(value, getCtx().currentTime, 0.05);
    if (param === 'filterQ' && t.filterNode) t.filterNode.Q.setTargetAtTime(value, getCtx().currentTime, 0.05);
    if (param === 'filterType' && t.filterNode) t.filterNode.type = value;
    if (param === 'reverbAmount') {
      if (t.reverbGain) t.reverbGain.gain.setTargetAtTime(t.reverbEnabled ? value : 0, getCtx().currentTime, 0.05);
      if (t.dryGain) t.dryGain.gain.setTargetAtTime(t.reverbEnabled ? 1 - value : 1, getCtx().currentTime, 0.05);
    }
    if (param === 'lfoRate' && t.lfoOsc) t.lfoOsc.frequency.setTargetAtTime(value, getCtx().currentTime, 0.05);
    if (param === 'ringCarrier' && t.ringOsc) {
      t.ringOsc.frequency.setTargetAtTime(value, getCtx().currentTime, 0.05);
      updateRingFreqDisplay(id);
    }
    if (param === 'crossfade' && isPlaying && t.buffer && t.loop) {
      buildTrackGraph(t);
      if (t.sourceNode) t.sourceNode.start(0);
    }
  }

  function setTrackEffect(id, effect, enabled) {
    var t = tracks[id]; t[effect] = enabled;
    if (effect === 'lfoEnabled') {
      document.querySelectorAll('#lfo-shapes-' + id + ' .mini-btn').forEach(function (b) { b.disabled = !enabled; });
      document.querySelectorAll('#lfo-target-' + id + ' .mini-btn').forEach(function (b) { b.disabled = !enabled; });
      var rateSl = document.getElementById('lfo-rate-' + id); if (rateSl) rateSl.disabled = !enabled;
      if (t.lfoGain) t.lfoGain.gain.setTargetAtTime(enabled ? getLfoDepth(t) : 0, getCtx().currentTime, 0.05);
    }
    if (effect === 'reverbEnabled') {
      var revSl = document.getElementById('reverb-slider-' + id); if (revSl) revSl.disabled = !enabled;
      if (t.reverbGain) t.reverbGain.gain.setTargetAtTime(enabled ? t.reverbAmount : 0, getCtx().currentTime, 0.05);
      if (t.dryGain) t.dryGain.gain.setTargetAtTime(enabled ? 1 - t.reverbAmount : 1, getCtx().currentTime, 0.05);
    }
    if (effect === 'ringEnabled') {
      var carrierSl = document.getElementById('ring-carrier-' + id); if (carrierSl) carrierSl.disabled = !enabled;
      if (t.ringWet) t.ringWet.gain.setTargetAtTime(enabled ? 1 : 0, getCtx().currentTime, 0.05);
      if (t.ringDry) t.ringDry.gain.setTargetAtTime(enabled ? 0 : 1, getCtx().currentTime, 0.05);
      var freqEl = document.getElementById('ring-freqs-' + id); if (freqEl) freqEl.style.opacity = enabled ? '0.7' : '0.4';
    }
  }

  function setLfoShape(id, shape) {
    var t = tracks[id]; t.lfoShape = shape; if (t.lfoOsc) t.lfoOsc.type = shape;
    document.querySelectorAll('#lfo-shapes-' + id + ' .mini-btn').forEach(function (b) {
      b.classList.toggle('on', b.dataset.shape === shape);
    });
  }

  function setLfoTarget(id, target) {
    var t = tracks[id];
    if (t.lfoGain) {
      try { t.lfoGain.disconnect(); } catch (e) {}
      t.lfoTarget = target;
      if (t.lfoEnabled) {
        t.lfoGain.gain.value = getLfoDepth(t);
        connectLfoTarget(t, t.lfoGain, t.gainNode, t.panNode, t.filterNode);
      }
    } else { t.lfoTarget = target; }
    document.querySelectorAll('#lfo-target-' + id + ' .mini-btn').forEach(function (b) {
      b.classList.toggle('on', b.dataset.target === target);
    });
  }

  /* Speed helpers — log scale */
  function speedSliderToSpeed(v) { return Math.pow(2, parseFloat(v)); }
  function speedToSlider(s) { return Math.log2(Math.max(0.125, Math.min(4, s))); }

  function onSpeedSlider(id, sliderVal) {
    var speed = speedSliderToSpeed(sliderVal);
    var l2 = Math.log2(speed);
    for (var i = 0; i < SPEED_SNAPS.length; i++) {
      if (Math.abs(l2 - Math.log2(SPEED_SNAPS[i])) < SNAP_THRESH_LOG2) { speed = SPEED_SNAPS[i]; break; }
    }
    speed = parseFloat(speed.toFixed(4));
    tracks[id].speed = speed;
    var exact = document.getElementById('spd-exact-' + id); if (exact) exact.value = speed.toFixed(3);
    var lbl = document.getElementById('spd-label-' + id); if (lbl) lbl.textContent = speed.toFixed(2) + '\u00d7';
    var pitch = document.getElementById('spd-pitch-' + id); if (pitch) pitch.textContent = speedToPitch(speed);
    if (tracks[id].sourceNode) tracks[id].sourceNode.playbackRate.setTargetAtTime(speed, getCtx().currentTime, 0.05);
    if (ratioLocked && id === 0) applyRatiosFromTrack0Speed(speed);
    updateRingFreqDisplay(id);
  }

  function onSpeedExact(id, val) {
    var speed = parseFloat(val); if (isNaN(speed) || speed <= 0) return;
    speed = Math.max(0.125, Math.min(4, speed));
    tracks[id].speed = speed;
    var slider = document.getElementById('spd-slider-' + id); if (slider) slider.value = speedToSlider(speed);
    var lbl = document.getElementById('spd-label-' + id); if (lbl) lbl.textContent = speed.toFixed(2) + '\u00d7';
    var pitch = document.getElementById('spd-pitch-' + id); if (pitch) pitch.textContent = speedToPitch(speed);
    if (tracks[id].sourceNode) tracks[id].sourceNode.playbackRate.setTargetAtTime(speed, getCtx().currentTime, 0.05);
    if (ratioLocked && id === 0) applyRatiosFromTrack0Speed(speed);
    updateRingFreqDisplay(id);
  }

  function speedToPitch(speed) {
    if (speed === 1) return 'original';
    var semis = Math.round(Math.log2(speed) * 12); if (semis === 0) return 'original';
    var abs = Math.abs(semis), dir = semis > 0 ? '\u2191' : '\u2193';
    var names = ['','m2','M2','m3','M3','P4','A4','P5','m6','M6','m7','M7','P8'];
    if (abs <= 12) return dir + (names[abs] || abs + 'st');
    var oct = Math.floor(abs / 12), rem = abs % 12;
    return dir + oct + 'oct' + (rem ? '+' + rem + 'st' : '');
  }

  function updateRingFreqDisplay(id) {
    var t = tracks[id], d = document.getElementById('ring-freqs-' + id); if (!d) return;
    var sf = BASE_FREQ * t.speed;
    d.textContent = 'carrier: ' + t.ringCarrier + ' Hz \u00b7 sum: ' + Math.round(sf + t.ringCarrier) +
      ' Hz \u00b7 diff: ' + Math.round(Math.abs(sf - t.ringCarrier)) + ' Hz';
  }

  /* ════════════════════════════════════════════════════════════
     RATIO PANEL
  ════════════════════════════════════════════════════════════ */
  function centsToName(c) {
    var st = Math.round(c / 100);
    if (st >= 0 && st <= 12) return INTERVAL_NAMES[st];
    if (st === 19) return 'P5+8va'; if (st === 24) return '2 oct';
    return st + 'st';
  }
  function ratioToInterval(num, den) {
    var cents = Math.round(Math.log2(num / den) * 1200);
    var near = Math.round(cents / 100) * 100, dev = cents - near;
    return dev === 0 ? centsToName(near) : centsToName(near) + ' ' + (dev > 0 ? '+' : '') + dev + '\u00a2';
  }

  function renderRatioGrid() {
    var grid = document.getElementById('ss-ratio-grid'); if (!grid) return;
    grid.innerHTML = tracks.map(function (t) {
      var fHz = (BASE_FREQ * t.speed).toFixed(1);
      var intv = t.id === 0 ? 'reference' : ratioToInterval(t.ratioNum, t.ratioDen);
      return '<div class="ratio-cell">' +
        '<div class="ratio-cell-label">Track ' + (t.id + 1) + '</div>' +
        '<div class="ratio-cell-main">' +
        '<input class="ratio-input" type="number" min="1" max="32" value="' + t.ratioNum + '" id="ratio-num-' + t.id + '">' +
        '<span>:</span>' +
        '<input class="ratio-input" type="number" min="1" max="32" value="' + t.ratioDen + '" id="ratio-den-' + t.id + '">' +
        '</div>' +
        '<div class="ratio-cell-freq" id="ratio-freq-' + t.id + '">' + fHz + ' Hz</div>' +
        '<div class="ratio-cell-interval" id="ratio-interval-' + t.id + '">' + intv + '</div>' +
        (t.id > 0 ? '<div class="mini-row"><button class="mini-btn" data-revert="' + t.id + '">revert</button></div>' : '') +
        '</div>';
    }).join('');
    grid.querySelectorAll('input.ratio-input').forEach(function (inp) {
      inp.addEventListener('change', function () {
        var id = parseInt(this.id.split('-')[2], 10);
        updateRatio(id);
      });
    });
    grid.querySelectorAll('[data-revert]').forEach(function (btn) {
      btn.addEventListener('click', function () { revertTrackRatio(parseInt(this.dataset.revert, 10)); });
    });
  }

  function updateRatio(id) {
    var t = tracks[id];
    t.ratioNum = Math.max(1, Math.min(32, parseInt(document.getElementById('ratio-num-' + id).value, 10) || 1));
    t.ratioDen = Math.max(1, Math.min(32, parseInt(document.getElementById('ratio-den-' + id).value, 10) || 1));
    var el = document.getElementById('ratio-interval-' + id);
    if (el) el.textContent = id === 0 ? 'reference' : ratioToInterval(t.ratioNum, t.ratioDen);
  }

  function revertTrackRatio(id) {
    var t = tracks[id]; t.ratioNum = id + 1; t.ratioDen = 1; t.speed = 1.0;
    var n = document.getElementById('ratio-num-' + id), d = document.getElementById('ratio-den-' + id);
    if (n) n.value = t.ratioNum; if (d) d.value = t.ratioDen;
    var ie = document.getElementById('ratio-interval-' + id); if (ie) ie.textContent = ratioToInterval(t.ratioNum, t.ratioDen);
    var fe = document.getElementById('ratio-freq-' + id); if (fe) fe.textContent = (BASE_FREQ * t.speed).toFixed(1) + ' Hz';
    var sl = document.getElementById('spd-slider-' + id); if (sl) sl.value = speedToSlider(1.0);
    var ex = document.getElementById('spd-exact-' + id); if (ex) ex.value = '1.000';
    var lb = document.getElementById('spd-label-' + id); if (lb) lb.textContent = '1.00\u00d7';
    var pc = document.getElementById('spd-pitch-' + id); if (pc) pc.textContent = 'original';
    if (t.sourceNode) t.sourceNode.playbackRate.setTargetAtTime(1.0, getCtx().currentTime, 0.1);
    updateRingFreqDisplay(id);
  }

  function applyRatios() {
    var t0 = tracks[0], base = BASE_FREQ * t0.speed;
    tracks.forEach(function (t) {
      var ratio = t.ratioNum / t.ratioDen;
      var ns = parseFloat(Math.max(0.125, Math.min(4, (base * ratio) / BASE_FREQ)).toFixed(4));
      t.speed = ns;
      if (t.sourceNode) t.sourceNode.playbackRate.setTargetAtTime(ns, getCtx().currentTime, 0.1);
      var sl = document.getElementById('spd-slider-' + t.id); if (sl) sl.value = speedToSlider(ns);
      var ex = document.getElementById('spd-exact-' + t.id); if (ex) ex.value = ns.toFixed(3);
      var lb = document.getElementById('spd-label-' + t.id); if (lb) lb.textContent = ns.toFixed(2) + '\u00d7';
      var pc = document.getElementById('spd-pitch-' + t.id); if (pc) pc.textContent = speedToPitch(ns);
      var fe = document.getElementById('ratio-freq-' + t.id); if (fe) fe.textContent = (BASE_FREQ * t.speed).toFixed(1) + ' Hz';
      updateRingFreqDisplay(t.id);
    });
  }

  function applyRatiosFromTrack0Speed(newSpeed) {
    var base = BASE_FREQ * newSpeed;
    tracks.forEach(function (t, i) {
      if (i === 0) return;
      var sp = parseFloat(Math.max(0.125, Math.min(4, (base * t.ratioNum / t.ratioDen) / BASE_FREQ)).toFixed(4));
      t.speed = sp;
      if (t.sourceNode) t.sourceNode.playbackRate.setTargetAtTime(sp, getCtx().currentTime, 0.1);
      var sl = document.getElementById('spd-slider-' + t.id); if (sl) sl.value = speedToSlider(sp);
      var ex = document.getElementById('spd-exact-' + t.id); if (ex) ex.value = sp.toFixed(3);
      var lb = document.getElementById('spd-label-' + t.id); if (lb) lb.textContent = sp.toFixed(2) + '\u00d7';
      var pc = document.getElementById('spd-pitch-' + t.id); if (pc) pc.textContent = speedToPitch(sp);
      updateRingFreqDisplay(t.id);
    });
  }

  /* ════════════════════════════════════════════════════════════
     TRACK UI BUILD
  ════════════════════════════════════════════════════════════ */
  function buildTrackEl(t) {
    var id = t.id;
    var spdSl = speedToSlider(t.speed);
    var div = document.createElement('div');
    div.className = 'track-card'; div.id = 'track-' + id;
    div.innerHTML =
      '<div class="track-head">' +
        '<span class="track-num">T' + (id + 1) + '</span>' +
        '<div class="track-ms">' +
          '<button class="mini-btn" id="mute-' + id + '" title="Mute (' + (id + 1) + ')">M</button>' +
          '<button class="mini-btn" id="solo-' + id + '" title="Solo (Shift+' + (id + 1) + ')">S</button>' +
        '</div>' +
        '<div class="track-src-btns">' +
          '<label class="upload-label" for="upload-' + id + '">upload</label>' +
          '<input type="file" id="upload-' + id + '" accept="audio/*" style="display:none">' +
          '<button class="lab-preset-btn" id="rec-' + id + '">&#9679;&#xFE0E; record</button>' +
        '</div>' +
        '<span class="track-name" id="tfile-' + id + '">No file loaded</span>' +
      '</div>' +
      '<div class="tape-status-row" id="tstatus-' + id + '" style="padding:0 0.85em;"></div>' +
      '<div class="track-wave"><canvas id="wave-' + id + '"></canvas></div>' +
      '<div class="track-controls">' +
        // Speed
        '<div class="ctrl-block"><div class="ctrl-block-label">Speed <span class="ctrl-block-val" id="spd-label-' + id + '">' + t.speed.toFixed(2) + '\u00d7</span></div>' +
          '<input type="range" min="-3" max="2" step="0.001" value="' + spdSl + '" id="spd-slider-' + id + '">' +
          '<div class="speed-exact-row"><input type="number" class="speed-exact" id="spd-exact-' + id + '" min="0.125" max="4" step="0.001" value="' + t.speed.toFixed(3) + '"><span style="font-size:0.6rem;opacity:0.5;">\u00d7</span></div>' +
          '<div class="pitch-label" id="spd-pitch-' + id + '">' + speedToPitch(t.speed) + '</div></div>' +
        // Loop + crossfade
        '<div class="ctrl-block"><div class="ctrl-block-label">Loop <label class="toggle"><input type="checkbox" id="loop-' + id + '" checked><span class="toggle-slider"></span></label></div>' +
          '<div class="ctrl-block-label" style="margin-top:0.5em;">Crossfade <span class="ctrl-block-val" id="xf-label-' + id + '">' + t.crossfade + 'ms</span></div>' +
          '<input type="range" min="0" max="400" step="5" value="' + t.crossfade + '" id="xf-slider-' + id + '"></div>' +
        // Filter
        '<div class="ctrl-block"><div class="ctrl-block-label">Filter</div>' +
          '<select id="filter-type-' + id + '"><option value="lowpass">Lowpass</option><option value="highpass">Highpass</option><option value="bandpass">Bandpass</option></select>' +
          '<div style="margin-top:0.4em;"><div class="ctrl-block-label">Cutoff <span class="ctrl-block-val" id="filter-freq-label-' + id + '">' + t.filterFreq + ' Hz</span></div>' +
          '<input type="range" min="100" max="10000" step="10" value="' + t.filterFreq + '" id="filter-freq-' + id + '"></div>' +
          '<div style="margin-top:0.4em;"><div class="ctrl-block-label">Resonance <span class="ctrl-block-val" id="filter-q-label-' + id + '">' + t.filterQ.toFixed(1) + '</span></div>' +
          '<input type="range" min="0.1" max="18" step="0.1" value="' + t.filterQ + '" id="filter-q-' + id + '"></div></div>' +
        // Volume + Pan
        '<div class="ctrl-block"><div class="ctrl-block-label">Volume <span class="ctrl-block-val" id="vol-label-' + id + '">' + Math.round(t.volume * 100) + '%</span></div>' +
          '<input type="range" min="0" max="1" step="0.01" value="' + t.volume + '" id="vol-' + id + '">' +
          '<div style="margin-top:0.5em;"><div class="ctrl-block-label">Pan <span class="ctrl-block-val" id="pan-label-' + id + '">C</span></div>' +
          '<input type="range" min="-1" max="1" step="0.01" value="' + t.pan + '" id="pan-' + id + '"></div></div>' +
        // Ring mod
        '<div class="ctrl-block"><div class="ctrl-block-label">Ring mod <label class="toggle"><input type="checkbox" id="ring-en-' + id + '"><span class="toggle-slider"></span></label></div>' +
          '<input type="range" min="10" max="2000" step="1" value="' + t.ringCarrier + '" id="ring-carrier-' + id + '" disabled>' +
          '<div class="ring-freq-line" id="ring-freqs-' + id + '" style="opacity:0.4;">carrier: ' + t.ringCarrier + ' Hz \u00b7 sum: \u2014 \u00b7 diff: \u2014</div></div>' +
        // Reverb
        '<div class="ctrl-block"><div class="ctrl-block-label">Reverb <label class="toggle"><input type="checkbox" id="reverb-en-' + id + '"><span class="toggle-slider"></span></label></div>' +
          '<input type="range" min="0" max="1" step="0.01" value="' + t.reverbAmount + '" id="reverb-slider-' + id + '" disabled></div>' +
        // LFO
        '<div class="ctrl-block" style="grid-column: 1 / -1;"><div class="ctrl-block-label">LFO <label class="toggle"><input type="checkbox" id="lfo-en-' + id + '"><span class="toggle-slider"></span></label></div>' +
          '<div class="mini-row" id="lfo-target-' + id + '">' +
            [['filter','F'],['volume','V'],['pan','P'],['ring','R']].map(function (pair) {
              return '<button class="mini-btn' + (t.lfoTarget === pair[0] ? ' on' : '') + '" data-target="' + pair[0] + '" disabled title="' + pair[0] + '">' + pair[1] + '</button>';
            }).join('') +
          '</div>' +
          '<input type="range" min="0.05" max="8" step="0.05" value="' + t.lfoRate + '" id="lfo-rate-' + id + '" disabled style="margin-top:0.4em;">' +
          '<div class="mini-row" id="lfo-shapes-' + id + '">' +
            ['sine','triangle','sawtooth','square'].map(function (s) {
              return '<button class="mini-btn' + (t.lfoShape === s ? ' on' : '') + '" data-shape="' + s + '" disabled>' + s[0].toUpperCase() + '</button>';
            }).join('') +
          '</div></div>' +
      '</div>';
    return div;
  }

  function renderTracks() {
    var c = document.getElementById('ss-tracks'); if (!c) return;
    c.innerHTML = '';
    tracks.forEach(function (t) { c.appendChild(buildTrackEl(t)); });
    tracks.forEach(function (t) {
      drawWaveform(t);
      wireTrackEvents(t.id);
    });
    renderMuteSoloUI();
  }

  function wireTrackEvents(id) {
    var t = tracks[id];

    document.getElementById('mute-' + id).addEventListener('click', function () { setMute(id); });
    document.getElementById('solo-' + id).addEventListener('click', function () { setSolo(id); });

    document.getElementById('upload-' + id).addEventListener('change', function (e) {
      if (e.target.files && e.target.files[0]) handleUpload(id, e.target.files[0]);
      e.target.value = '';
    });
    document.getElementById('rec-' + id).addEventListener('click', function () { toggleRecord(id); });

    document.getElementById('spd-slider-' + id).addEventListener('input', function (e) { onSpeedSlider(id, e.target.value); });
    document.getElementById('spd-exact-' + id).addEventListener('change', function (e) { onSpeedExact(id, e.target.value); });

    document.getElementById('loop-' + id).addEventListener('change', function (e) { setTrackParam(id, 'loop', e.target.checked); });
    document.getElementById('xf-slider-' + id).addEventListener('input', function (e) {
      setTrackParam(id, 'crossfade', +e.target.value);
      document.getElementById('xf-label-' + id).textContent = e.target.value + 'ms';
    });

    document.getElementById('filter-type-' + id).value = t.filterType;
    document.getElementById('filter-type-' + id).addEventListener('change', function (e) { setTrackParam(id, 'filterType', e.target.value); });
    document.getElementById('filter-freq-' + id).addEventListener('input', function (e) {
      setTrackParam(id, 'filterFreq', +e.target.value);
      document.getElementById('filter-freq-label-' + id).textContent = e.target.value + ' Hz';
    });
    document.getElementById('filter-q-' + id).addEventListener('input', function (e) {
      setTrackParam(id, 'filterQ', +e.target.value);
      document.getElementById('filter-q-label-' + id).textContent = parseFloat(e.target.value).toFixed(1);
    });

    document.getElementById('vol-' + id).addEventListener('input', function (e) {
      setTrackParam(id, 'volume', +e.target.value);
      document.getElementById('vol-label-' + id).textContent = Math.round(e.target.value * 100) + '%';
    });
    document.getElementById('pan-' + id).addEventListener('input', function (e) {
      var v = +e.target.value;
      setTrackParam(id, 'pan', v);
      document.getElementById('pan-label-' + id).textContent = v === 0 ? 'C' : (v > 0 ? 'R' + Math.round(v * 100) : 'L' + Math.round(Math.abs(v) * 100));
    });

    document.getElementById('ring-en-' + id).addEventListener('change', function (e) { setTrackEffect(id, 'ringEnabled', e.target.checked); });
    document.getElementById('ring-carrier-' + id).addEventListener('input', function (e) { setTrackParam(id, 'ringCarrier', +e.target.value); });

    document.getElementById('reverb-en-' + id).addEventListener('change', function (e) { setTrackEffect(id, 'reverbEnabled', e.target.checked); });
    document.getElementById('reverb-slider-' + id).addEventListener('input', function (e) { setTrackParam(id, 'reverbAmount', +e.target.value); });

    document.getElementById('lfo-en-' + id).addEventListener('change', function (e) { setTrackEffect(id, 'lfoEnabled', e.target.checked); });
    document.getElementById('lfo-rate-' + id).addEventListener('input', function (e) { setTrackParam(id, 'lfoRate', +e.target.value); });
    document.querySelectorAll('#lfo-target-' + id + ' .mini-btn').forEach(function (b) {
      b.addEventListener('click', function () { setLfoTarget(id, this.dataset.target); });
    });
    document.querySelectorAll('#lfo-shapes-' + id + ' .mini-btn').forEach(function (b) {
      b.addEventListener('click', function () { setLfoShape(id, this.dataset.shape); });
    });
  }

  /* ════════════════════════════════════════════════════════════
     OFFLINE RENDER → WAV DOWNLOAD
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
    var off = 44;
    for (var i = 0; i < len; i++) {
      for (var c = 0; c < numCh; c++) {
        var s = Math.max(-1, Math.min(1, buffer.getChannelData(c)[i]));
        view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7FFF, true); off += 2;
      }
    }
    return new Blob([ab], { type: 'audio/wav' });
  }

  function renderOfflineMix(durationSec) {
    var ctx = getCtx();
    var sr = ctx.sampleRate;
    var offlineCtx = new OfflineAudioContext(2, Math.ceil(sr * durationSec), sr);
    var offlineIR = makeReverbImpulse(offlineCtx);
    var masterOut = offlineCtx.createGain();
    masterOut.gain.value = masterGain ? masterGain.gain.value : 0.8;
    masterOut.connect(offlineCtx.destination);

    tracks.forEach(function (t) {
      if (!t.buffer) return;
      buildOfflineTrackGraphFull(offlineCtx, t, offlineIR, masterOut);
    });

    return offlineCtx.startRendering();
  }

  /* Full offline graph builder, including ring-mod LFO targeting */
  function buildOfflineTrackGraphFull(offlineCtx, t, offlineIR, masterOut) {
    var buf = (t.loop && t.crossfade > 0) ? applyCrossfadeToBuffer(offlineCtx, t.buffer, t.crossfade) : t.buffer;
    var src = offlineCtx.createBufferSource();
    src.buffer = buf; src.playbackRate.value = t.speed; src.loop = t.loop;

    var filterNode = offlineCtx.createBiquadFilter();
    filterNode.type = t.filterType; filterNode.frequency.value = t.filterFreq; filterNode.Q.value = t.filterQ;

    var ringHolder = { ringEnabled: t.ringEnabled, ringCarrier: t.ringCarrier };
    var ringMerge = buildRingMod(offlineCtx, ringHolder, filterNode);

    var lfoOsc = offlineCtx.createOscillator(), lfoGain = offlineCtx.createGain();
    lfoOsc.type = t.lfoShape; lfoOsc.frequency.value = t.lfoRate;
    lfoGain.gain.value = t.lfoEnabled ? getLfoDepth(t) : 0;
    lfoOsc.connect(lfoGain); lfoOsc.start(0);

    var gainNode = offlineCtx.createGain(); gainNode.gain.value = computeEffectiveGain(t);
    var panNode = offlineCtx.createStereoPanner(); panNode.pan.value = t.pan;

    if (t.lfoEnabled) {
      if (t.lfoTarget === 'filter') lfoGain.connect(filterNode.frequency);
      else if (t.lfoTarget === 'volume') lfoGain.connect(gainNode.gain);
      else if (t.lfoTarget === 'pan') lfoGain.connect(panNode.pan);
      else if (t.lfoTarget === 'ring' && ringHolder.ringOsc) lfoGain.connect(ringHolder.ringOsc.frequency);
    }

    var dryGain = offlineCtx.createGain(), reverbGain = offlineCtx.createGain(), convolver = offlineCtx.createConvolver();
    convolver.buffer = offlineIR;
    dryGain.gain.value = t.reverbEnabled ? 1 - t.reverbAmount : 1;
    reverbGain.gain.value = t.reverbEnabled ? t.reverbAmount : 0;

    src.connect(filterNode);
    ringMerge.connect(gainNode);
    gainNode.connect(panNode);
    panNode.connect(dryGain); panNode.connect(convolver);
    dryGain.connect(masterOut); convolver.connect(reverbGain); reverbGain.connect(masterOut);

    src.start(0);
  }

  function initDownload() {
    var btn = document.getElementById('ss-download-btn');
    var durSel = document.getElementById('ss-download-dur');
    var status = document.getElementById('ss-download-status');
    if (!btn) return;
    btn.addEventListener('click', function () {
      var dur = parseInt(durSel.value, 10) || 30;
      btn.disabled = true; status.textContent = 'rendering\u2026';
      renderOfflineMix(dur).then(function (rendered) {
        var blob = audioBufferToWav(rendered);
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url; a.download = 'soundscape-machine-' + Date.now() + '.wav';
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
        status.textContent = 'done \u2014 check your downloads';
        btn.disabled = false;
        setTimeout(function () { status.textContent = ''; }, 3000);
      }).catch(function (err) {
        status.textContent = 'render failed';
        btn.disabled = false;
        console.error(err);
      });
    });
  }

  /* ════════════════════════════════════════════════════════════
     INIT
  ════════════════════════════════════════════════════════════ */
  function init() {
    renderTracks();
    renderRatioGrid();
    updatePlayBtnAvailability();

    var playBtn = document.getElementById('ss-play');
    var stopBtn = document.getElementById('ss-stop');
    if (playBtn) playBtn.addEventListener('click', transportPlay);
    if (stopBtn) stopBtn.addEventListener('click', transportStop);

    var masterVol = document.getElementById('ss-master-vol');
    if (masterVol) masterVol.addEventListener('input', function (e) {
      ensureMaster();
      masterGain.gain.setTargetAtTime(+e.target.value, getCtx().currentTime, 0.05);
      document.getElementById('ss-master-vol-val').textContent = Math.round(e.target.value * 100) + '%';
    });

    var ratioLock = document.getElementById('ss-ratio-lock');
    if (ratioLock) ratioLock.addEventListener('change', function (e) { ratioLocked = e.target.checked; });
    var ratioApply = document.getElementById('ss-ratio-apply');
    if (ratioApply) ratioApply.addEventListener('click', applyRatios);
    var ratioRevert = document.getElementById('ss-ratio-revert');
    if (ratioRevert) ratioRevert.addEventListener('click', function () {
      tracks.forEach(function (t, i) { if (i > 0) revertTrackRatio(i); });
    });

    initDownload();

    // Generate reverb impulse once, non-fatally
    try { ensureMaster(); reverbIR = makeReverbImpulse(getCtx()); } catch (e) {}

    document.addEventListener('keydown', function (e) {
      var tag = document.activeElement && document.activeElement.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.code === 'Space') { e.preventDefault(); if (isPlaying) transportStop(); else transportPlay(); }
      if (e.code === 'Escape') { e.preventDefault(); transportStop(); }
      var idx = ['Digit1','Digit2','Digit3','Digit4'].indexOf(e.code);
      if (idx >= 0) { e.preventDefault(); if (e.shiftKey) setSolo(idx); else setMute(idx); }
    });

    window.addEventListener('resize', function () { tracks.forEach(drawWaveform); });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

}());
