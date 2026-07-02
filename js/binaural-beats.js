(function () {
  'use strict';

  /* ── Presets ── */
  var PRESETS = {
    sleep:   { carrier: 200, beat: 2,   ambient: 'brown', ambientVol: 0.4,  label: 'delta', desc: 'deep sleep · restorative · 0.5–4 Hz' },
    calm:    { carrier: 220, beat: 6,   ambient: 'pink',  ambientVol: 0.35, label: 'theta', desc: 'drowsy · meditative · 4–8 Hz' },
    focus:   { carrier: 200, beat: 10,  ambient: 'none',  ambientVol: 0.3,  label: 'alpha', desc: 'relaxed wakefulness · eyes closed · 8–13 Hz' },
    energise:{ carrier: 220, beat: 20,  ambient: 'none',  ambientVol: 0.2,  label: 'beta',  desc: 'alert · focused · active thinking · 13–30 Hz' },
    custom:  null
  };

  /* ── EEG band lookup ── */
  function getBand(hz) {
    if (hz < 4)  return { name: 'delta', desc: 'deep sleep · restorative · 0.5–4 Hz' };
    if (hz < 8)  return { name: 'theta', desc: 'drowsy · meditative · 4–8 Hz' };
    if (hz < 13) return { name: 'alpha', desc: 'relaxed wakefulness · eyes closed · 8–13 Hz' };
    if (hz < 30) return { name: 'beta',  desc: 'alert · focused · active thinking · 13–30 Hz' };
    return             { name: 'gamma', desc: 'high-level processing · binding · 30+ Hz' };
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
  var audioCtx    = null;
  var leftOsc     = null;
  var rightOsc    = null;
  var masterGain  = null;
  var merger      = null;
  var ambientSrc  = null;
  var ambientGain = null;

  var playing       = false;
  var timerInterval = null;
  var timerRemaining = 0;

  /* ── Init audio ── */
  function initAudio() {
    if (audioCtx) return;
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    masterGain = audioCtx.createGain();
    masterGain.gain.value = state.vol;
    masterGain.connect(audioCtx.destination);

    ambientGain = audioCtx.createGain();
    ambientGain.gain.value = 0;
    ambientGain.connect(audioCtx.destination);
  }

  /* ── Noise buffers ── */
  function makePinkBuf(actx, durationSecs) {
    var sr = actx.sampleRate;
    var len = Math.floor(sr * durationSecs);
    var buf = actx.createBuffer(1, len, sr);
    var d = buf.getChannelData(0);
    var b0=0,b1=0,b2=0,b3=0,b4=0,b5=0,b6=0;
    for (var i = 0; i < len; i++) {
      var w = Math.random()*2-1;
      b0=0.99886*b0+w*0.0555179; b1=0.99332*b1+w*0.0750759;
      b2=0.96900*b2+w*0.1538520; b3=0.86650*b3+w*0.3104856;
      b4=0.55000*b4+w*0.5329522; b5=-0.7616*b5-w*0.0168980;
      d[i]=(b0+b1+b2+b3+b4+b5+b6+w*0.5362)*0.11;
      b6=w*0.115926;
    }
    return buf;
  }

  function makeBrownBuf(actx, durationSecs) {
    var sr = actx.sampleRate;
    var len = Math.floor(sr * durationSecs);
    var buf = actx.createBuffer(1, len, sr);
    var d = buf.getChannelData(0);
    var last = 0;
    for (var i = 0; i < len; i++) {
      var w = Math.random()*2-1;
      last = (last + 0.02*w) / 1.02;
      d[i] = last * 3.5;
    }
    return buf;
  }

  /* ── Ambient ── */
  function startAmbient() {
    stopAmbient();
    if (state.ambient === 'none' || !audioCtx) return;
    var buf = state.ambient === 'pink' ? makePinkBuf(audioCtx, 4) : makeBrownBuf(audioCtx, 4);
    ambientSrc = audioCtx.createBufferSource();
    ambientSrc.buffer = buf;
    ambientSrc.loop = true;
    ambientSrc.connect(ambientGain);
    ambientSrc.start();
    ambientGain.gain.setValueAtTime(state.ambientVol, audioCtx.currentTime);
  }

  function stopAmbient() {
    if (ambientSrc) { try { ambientSrc.stop(); } catch(e) {} ambientSrc = null; }
    if (ambientGain && audioCtx) ambientGain.gain.setValueAtTime(0, audioCtx.currentTime);
  }

  /* ── Tones ── */
  function startTones() {
    stopTones();
    merger = audioCtx.createChannelMerger(2);
    merger.connect(masterGain);

    var lg = audioCtx.createGain(); lg.gain.value = 1;
    var rg = audioCtx.createGain(); rg.gain.value = 1;

    leftOsc  = audioCtx.createOscillator();
    rightOsc = audioCtx.createOscillator();
    leftOsc.type  = 'sine';
    rightOsc.type = 'sine';
    leftOsc.frequency.value  = state.carrier;
    rightOsc.frequency.value = state.carrier + state.beat;

    leftOsc.connect(lg);  lg.connect(merger, 0, 0);
    rightOsc.connect(rg); rg.connect(merger, 0, 1);

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
      btn.innerHTML = 'stop';
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
    btn.innerHTML = 'play';
    btn.classList.remove('on');
    document.getElementById('timer-display').textContent = '';
  }

  /* ── Frequency update ── */
  function updateFrequencies() {
    if (leftOsc  && playing) leftOsc.frequency.setValueAtTime(state.carrier, audioCtx.currentTime);
    if (rightOsc && playing) rightOsc.frequency.setValueAtTime(state.carrier + state.beat, audioCtx.currentTime);
    updateDisplays();
  }

  function updateDisplays() {
    var band = getBand(state.beat);
    document.getElementById('disp-left').textContent      = state.carrier + ' Hz';
    document.getElementById('disp-right').textContent     = (state.carrier + state.beat) + ' Hz';
    document.getElementById('disp-beat').textContent      = state.beat + ' Hz';
    document.getElementById('disp-band').textContent      = band.name;
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
    document.getElementById('timer-display').textContent = m + ':' + (s < 10 ? '0' : '') + s;
  }

  /* ── WAV export ── */
  function exportWav() {
    if (state.timerMins === 0) return;
    var btn = document.getElementById('btn-download');
    var note = document.getElementById('download-note');
    btn.textContent = 'rendering\u2026';
    btn.disabled = true;
    note.textContent = 'rendering audio, this may take a moment\u2026';

    var durationSecs = state.timerMins * 60;
    var sr = 44100;
    var offCtx = new OfflineAudioContext(2, sr * durationSecs, sr);

    /* Binaural tones */
    var offMerger = offCtx.createChannelMerger(2);
    offMerger.connect(offCtx.destination);

    var offMaster = offCtx.createGain();
    offMaster.gain.value = state.vol;
    offMaster.connect(offCtx.destination);

    var offMerger2 = offCtx.createChannelMerger(2);
    offMerger2.connect(offMaster);

    var offL = offCtx.createOscillator();
    var offR = offCtx.createOscillator();
    var offLG = offCtx.createGain(); offLG.gain.value = 1;
    var offRG = offCtx.createGain(); offRG.gain.value = 1;
    offL.type = 'sine'; offL.frequency.value = state.carrier;
    offR.type = 'sine'; offR.frequency.value = state.carrier + state.beat;
    offL.connect(offLG); offLG.connect(offMerger2, 0, 0);
    offR.connect(offRG); offRG.connect(offMerger2, 0, 1);
    offL.start(0); offR.start(0);
    offL.stop(durationSecs); offR.stop(durationSecs);

    /* Ambient layer — mono, same to both channels */
    if (state.ambient !== 'none') {
      var ambBuf = state.ambient === 'pink'
        ? makePinkBuf(offCtx, Math.min(durationSecs, 4))
        : makeBrownBuf(offCtx, Math.min(durationSecs, 4));
      var offAmb = offCtx.createBufferSource();
      offAmb.buffer = ambBuf;
      offAmb.loop = true;
      var offAmbG = offCtx.createGain();
      offAmbG.gain.value = state.ambientVol;
      offAmb.connect(offAmbG);
      offAmbG.connect(offCtx.destination);
      offAmb.start(0);
      offAmb.stop(durationSecs);
    }

    offCtx.startRendering().then(function (renderedBuffer) {
      var wavBlob = audioBufferToWav(renderedBuffer);
      var url = URL.createObjectURL(wavBlob);
      var a = document.createElement('a');
      a.href = url;
      var preset = getActivePresetName();
      a.download = 'binaural-' + preset + '-' + state.timerMins + 'min.wav';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 5000);

      btn.textContent = 'download wav';
      btn.disabled = false;
      note.textContent = state.timerMins + ' min · ' + formatFileSize(renderedBuffer);
    }).catch(function (err) {
      btn.textContent = 'download wav';
      btn.disabled = false;
      note.textContent = 'render failed — please try again';
      console.error('WAV render error:', err);
    });
  }

  function getActivePresetName() {
    var active = document.querySelector('[data-p].on');
    return active ? active.getAttribute('data-p') : 'custom';
  }

  function formatFileSize(buffer) {
    var bytes = buffer.length * buffer.numberOfChannels * 2 + 44;
    if (bytes > 1048576) return (bytes / 1048576).toFixed(0) + ' MB';
    return (bytes / 1024).toFixed(0) + ' KB';
  }

  /* ── PCM → WAV blob ── */
  function audioBufferToWav(buffer) {
    var numChannels = buffer.numberOfChannels;
    var sampleRate  = buffer.sampleRate;
    var numSamples  = buffer.length;
    var bytesPerSample = 2;
    var blockAlign  = numChannels * bytesPerSample;
    var byteRate    = sampleRate * blockAlign;
    var dataSize    = numSamples * blockAlign;
    var bufSize     = 44 + dataSize;
    var ab = new ArrayBuffer(bufSize);
    var view = new DataView(ab);

    function writeStr(off, str) {
      for (var i = 0; i < str.length; i++) view.setUint8(off + i, str.charCodeAt(i));
    }

    writeStr(0, 'RIFF');
    view.setUint32(4, bufSize - 8, true);
    writeStr(8, 'WAVE');
    writeStr(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, byteRate, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bytesPerSample * 8, true);
    writeStr(36, 'data');
    view.setUint32(40, dataSize, true);

    var offset = 44;
    for (var i = 0; i < numSamples; i++) {
      for (var ch = 0; ch < numChannels; ch++) {
        var sample = buffer.getChannelData(ch)[i];
        sample = Math.max(-1, Math.min(1, sample));
        view.setInt16(offset, sample < 0 ? sample * 32768 : sample * 32767, true);
        offset += 2;
      }
    }
    return new Blob([ab], { type: 'audio/wav' });
  }

  /* ── Presets ── */
  function applyPreset(name) {
    var p = PRESETS[name];
    if (!p) return;
    state.carrier    = p.carrier;
    state.beat       = p.beat;
    state.ambientVol = p.ambientVol;
    state.ambient    = p.ambient;

    document.getElementById('carrier').value     = p.carrier;
    document.getElementById('beat-freq').value   = p.beat;
    document.getElementById('ambient-vol').value = p.ambientVol;
    document.getElementById('carrier-val').textContent     = p.carrier + ' Hz';
    document.getElementById('beat-val').textContent        = p.beat + ' Hz';
    document.getElementById('ambient-vol-val').textContent = Math.round(p.ambientVol * 100) + '%';

    setAmbient(p.ambient, true);
    updateFrequencies();

    document.querySelectorAll('[data-p]').forEach(function (b) {
      b.classList.toggle('on', b.getAttribute('data-p') === name);
    });
  }

  function setAmbient(type, skipPresetClear) {
    state.ambient = type;
    if (playing) startAmbient();
    document.querySelectorAll('[data-ambient]').forEach(function (b) {
      b.classList.toggle('on', b.getAttribute('data-ambient') === type);
    });
    if (!skipPresetClear) clearPresetSelection();
  }

  function clearPresetSelection() {
    document.querySelectorAll('[data-p]').forEach(function (b) { b.classList.remove('on'); });
    document.querySelector('[data-p="custom"]').classList.add('on');
  }

  /* ── Download button state ── */
  function updateDownloadBtn() {
    var btn  = document.getElementById('btn-download');
    var note = document.getElementById('download-note');
    if (state.timerMins > 0) {
      btn.disabled = false;
      var approxMB = Math.round((state.timerMins * 60 * 44100 * 2 * 2 + 44) / 1048576);
      note.textContent = 'will export ' + state.timerMins + ' min · approx ' + approxMB + ' MB';
    } else {
      btn.disabled = true;
      note.textContent = 'select a timer duration to enable download';
    }
  }

  /* ── Init ── */
  function init() {
    document.getElementById('btn-play').addEventListener('click', togglePlay);
    document.getElementById('btn-download').addEventListener('click', exportWav);

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
      if (masterGain && audioCtx) masterGain.gain.setValueAtTime(state.vol, audioCtx.currentTime);
    });

    document.getElementById('ambient-vol').addEventListener('input', function (e) {
      state.ambientVol = parseFloat(e.target.value);
      document.getElementById('ambient-vol-val').textContent = Math.round(state.ambientVol * 100) + '%';
      if (ambientGain && audioCtx) ambientGain.gain.setValueAtTime(state.ambientVol, audioCtx.currentTime);
    });

    document.querySelectorAll('[data-ambient]').forEach(function (btn) {
      btn.addEventListener('click', function () { setAmbient(btn.getAttribute('data-ambient')); });
    });

    document.querySelectorAll('[data-mins]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        state.timerMins = parseInt(btn.getAttribute('data-mins'), 10);
        document.querySelectorAll('[data-mins]').forEach(function (b) {
          b.classList.toggle('on', b === btn);
        });
        if (playing && state.timerMins > 0) { startTimer(); }
        else if (state.timerMins === 0)     { clearTimer(); }
        updateDownloadBtn();
      });
    });

    document.querySelectorAll('[data-p]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var name = btn.getAttribute('data-p');
        if (name !== 'custom') applyPreset(name);
      });
    });

    applyPreset('focus');
    updateDisplays();
    updateDownloadBtn();
  }

  init();

}());
