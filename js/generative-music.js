(function () {
  'use strict';

  /* ════════════════════════════════
     SHARED
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

  /* Normalize a buffer's peak to targetPeak (in-place) */
  function normalizeBuffer(buf, targetPeak) {
    targetPeak = targetPeak || 0.78;
    var data = buf.getChannelData(0);
    var peak = 0;
    for (var i = 0; i < data.length; i++) {
      var abs = Math.abs(data[i]);
      if (abs > peak) peak = abs;
    }
    if (peak < 0.001) return; /* silence — skip */
    var scale = targetPeak / peak;
    for (var i = 0; i < data.length; i++) data[i] *= scale;
  }

  /* Encode AudioBuffer to 16-bit WAV ArrayBuffer */
  function audioBufferToWav(buffer) {
    var nc   = buffer.numberOfChannels;
    var sr   = buffer.sampleRate;
    var len  = buffer.length;
    var bps  = 2;
    var dataLen = len * nc * bps;
    var wav  = new ArrayBuffer(44 + dataLen);
    var v    = new DataView(wav);
    function ws(off, s) { for (var i = 0; i < s.length; i++) v.setUint8(off+i, s.charCodeAt(i)); }
    function clamp(x) { return Math.max(-1, Math.min(1, x)); }
    ws(0, 'RIFF'); v.setUint32(4, 36+dataLen, true);
    ws(8, 'WAVE'); ws(12, 'fmt '); v.setUint32(16, 16, true);
    v.setUint16(20, 1, true); v.setUint16(22, nc, true);
    v.setUint32(24, sr, true); v.setUint32(28, sr*nc*bps, true);
    v.setUint16(32, nc*bps, true); v.setUint16(34, 16, true);
    ws(36, 'data'); v.setUint32(40, dataLen, true);
    var off = 44;
    var chans = [];
    for (var c = 0; c < nc; c++) chans.push(buffer.getChannelData(c));
    for (var i = 0; i < len; i++) {
      for (var c = 0; c < nc; c++) {
        v.setInt16(off, Math.round(clamp(chans[c][i]) * 32767), true);
        off += 2;
      }
    }
    return wav;
  }

  function triggerDownload(arrayBuf, filename) {
    var blob = new Blob([arrayBuf], { type: 'audio/wav' });
    var url  = URL.createObjectURL(blob);
    var a    = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    document.body.removeChild(a); URL.revokeObjectURL(url);
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
      d[i]=(b0+b1+b2+b3+b4+b5+b6+w*0.5362)*0.11; b6=w*0.115926;
    }
    return buf;
  }

  /* ════════════════════════════════
     LUCIER MODULE
  ════════════════════════════════ */

  /* Room filter frequencies — using medium as the single default */
  var ROOM_FREQS = [210, 380, 580, 850, 1200, 1600];
  var ROOM_Q     = 24;

  var lucier = {
    iterations:   [],  /* AudioBuffer[] — index 0 is original */
    currentIter:  0,
    isPlaying:    false,
    isLooping:    false,
    isRecording:  false,
    isProcessing: false,
    hasRecording: false,
    sourceType:   'generated' /* 'generated' | 'mic' | 'file' */
  };

  var lSrc    = null;
  var lGain   = null;
  var mRec    = null;
  var recChunks = [];

  /* ── Voice generation ── */
  function generateVoiceBuffer(ctx) {
    var sr = ctx.sampleRate, len = Math.floor(sr * 2.5);
    var buf = ctx.createBuffer(1, len, sr);
    var d   = buf.getChannelData(0);
    var b0=0,b1=0,b2=0,b3=0,b4=0,b5=0,b6=0;
    for (var i = 0; i < len; i++) {
      var w = Math.random() * 2 - 1;
      b0=0.99886*b0+w*0.0555179; b1=0.99332*b1+w*0.0750759;
      b2=0.96900*b2+w*0.1538520; b3=0.86650*b3+w*0.3104856;
      b4=0.55000*b4+w*0.5329522; b5=-0.7616*b5-w*0.0168980;
      d[i]=(b0+b1+b2+b3+b4+b5+b6+w*0.5362)*0.12; b6=w*0.115926;
    }
    /* Amplitude envelope */
    var atk = Math.floor(sr*0.08), dec = Math.floor(sr*0.25);
    for (var i = 0; i < atk; i++) d[i] *= i/atk;
    for (var i = 0; i < dec; i++) d[len-1-i] *= i/dec;
    return applyFormants(ctx, buf);
  }

  function applyFormants(ctx, buf) {
    var sr=ctx.sampleRate, len=buf.length;
    var off = new OfflineAudioContext(1, len, sr);
    var src = off.createBufferSource();
    var copy = off.createBuffer(1, len, sr);
    copy.getChannelData(0).set(buf.getChannelData(0));
    src.buffer = copy;
    var mg = off.createGain(); mg.gain.value = 0.7; mg.connect(off.destination);
    [[730,8],[1090,6],[2440,5]].forEach(function(f) {
      var flt = off.createBiquadFilter();
      flt.type='bandpass'; flt.frequency.value=f[0]; flt.Q.value=f[1];
      src.connect(flt); flt.connect(mg);
    });
    src.start(0);
    return off.startRendering();
  }

  /* ── Apply one room iteration ── */
  function applyIteration(inputBuf) {
    var sr  = inputBuf.sampleRate, len = inputBuf.length;
    var off = new OfflineAudioContext(1, len, sr);
    var src = off.createBufferSource();
    var copy = off.createBuffer(1, len, sr);
    copy.getChannelData(0).set(inputBuf.getChannelData(0));
    src.buffer = copy;
    var mg = off.createGain(); mg.gain.value = 1.0; mg.connect(off.destination);
    ROOM_FREQS.forEach(function(freq) {
      var flt = off.createBiquadFilter();
      flt.type='bandpass'; flt.frequency.value=freq; flt.Q.value=ROOM_Q;
      src.connect(flt); flt.connect(mg);
    });
    src.start(0);
    return off.startRendering().then(function(rendered) {
      normalizeBuffer(rendered, 0.78); /* normalize after each iteration */
      return rendered;
    });
  }

  /* ── Playback ── */
  function lucierPlay() {
    if (lucier.iterations.length === 0) return;
    lucierStop();
    var ctx = resumeCtx();
    lGain = ctx.createGain(); lGain.gain.value = 0.8;
    lGain.connect(ctx.destination);
    lSrc = ctx.createBufferSource();
    lSrc.buffer = lucier.iterations[lucier.currentIter];
    lSrc.loop   = lucier.isLooping;
    lSrc.connect(lGain);
    lSrc.onended = function() {
      if (!lucier.isLooping) {
        lucier.isPlaying = false;
        setLBtn('&#9654;&#xFE0E; play', false);
      }
    };
    lSrc.start();
    lucier.isPlaying = true;
    setLBtn('&#9632;&#xFE0E; stop', true);
  }

  function lucierStop() {
    if (lSrc) { try { lSrc.stop(); } catch(e){} lSrc = null; }
    lucier.isPlaying = false;
    setLBtn('&#9654;&#xFE0E; play', false);
  }

  function setLBtn(html, on) {
    var btn = document.getElementById('lucier-play');
    btn.innerHTML = html;
    btn.classList.toggle('on', on);
  }

  /* ── Iterate ── */
  function lucierIterate() {
    if (lucier.isProcessing || lucier.iterations.length === 0) return;
    lucierStop();
    lucier.isProcessing = true;
    setLucierStatus('processing…');
    document.getElementById('lucier-iterate').disabled = true;

    var cur = lucier.iterations[lucier.currentIter];
    applyIteration(cur).then(function(rendered) {
      lucier.iterations = lucier.iterations.slice(0, lucier.currentIter + 1);
      lucier.iterations.push(rendered);
      lucier.currentIter = lucier.iterations.length - 1;
      lucier.isProcessing = false;
      document.getElementById('lucier-iterate').disabled = false;
      updateLucierDisplay();
      updateDownloadSelects();
      setLucierStatus('ready');
      lucierPlay();
    }).catch(function() {
      lucier.isProcessing = false;
      document.getElementById('lucier-iterate').disabled = false;
      setLucierStatus('error — try again');
    });
  }

  /* ── Reset ── */
  function lucierReset() {
    lucierStop();
    lucier.currentIter = 0;
    updateLucierDisplay();
    updateDownloadSelects();
    setLucierStatus('reset to original');
  }

  /* ── Display ── */
  function updateLucierDisplay() {
    var n = lucier.currentIter, total = lucier.iterations.length;
    document.getElementById('lucier-iter-count').textContent = 'iteration ' + n;
    document.getElementById('lucier-iter-sub').textContent   = n === 0
      ? 'original source · unprocessed'
      : n + ' of ' + (total-1) + ' iteration' + (total-1===1?'':'s');
  }

  function setLucierStatus(msg) {
    document.getElementById('lucier-status').textContent = msg;
  }

  /* ── Download selects ── */
  function updateDownloadSelects() {
    var max  = lucier.iterations.length - 1;
    var from = document.getElementById('lucier-dl-from');
    var to   = document.getElementById('lucier-dl-to');
    from.innerHTML = '';
    to.innerHTML   = '';
    for (var i = 0; i <= max; i++) {
      from.innerHTML += '<option value="'+i+'">from iter '+i+'</option>';
      to.innerHTML   += '<option value="'+i+'"'+(i===max?' selected':'')+'>to iter '+i+'</option>';
    }
    var hasIters = max >= 1;
    document.getElementById('lucier-dl-btn').disabled = !hasIters;
    document.getElementById('lucier-dl-note').textContent = hasIters
      ? 'approx ' + estimateLucierSize() + ' MB'
      : 'build iterations first';
  }

  function estimateLucierSize() {
    var from  = parseInt(document.getElementById('lucier-dl-from').value, 10);
    var to    = parseInt(document.getElementById('lucier-dl-to').value, 10);
    var loops = parseInt(document.getElementById('lucier-dl-loops').value, 10);
    var count = Math.max(0, to - from + 1) * loops;
    /* each buffer ~2.5s, 44100 Hz, mono, 16-bit = ~220KB */
    var mb = (count * 0.22).toFixed(1);
    return mb;
  }

  /* ── Download ── */
  function lucierDownload() {
    var from  = parseInt(document.getElementById('lucier-dl-from').value, 10);
    var to    = parseInt(document.getElementById('lucier-dl-to').value, 10);
    var loops = parseInt(document.getElementById('lucier-dl-loops').value, 10);
    if (to < from) to = from;

    var bufs = [];
    for (var l = 0; l < loops; l++) {
      for (var i = from; i <= to; i++) {
        if (lucier.iterations[i]) bufs.push(lucier.iterations[i]);
      }
    }
    if (bufs.length === 0) return;

    var btn      = document.getElementById('lucier-dl-btn');
    var note     = document.getElementById('lucier-dl-note');
    var progress = document.getElementById('lucier-dl-progress');
    btn.disabled = true;
    note.style.display     = 'none';
    progress.style.display = 'inline';

    var sr    = bufs[0].sampleRate;
    var total = bufs.reduce(function(s,b){return s+b.length;}, 0);
    var off   = new OfflineAudioContext(1, total, sr);
    var offset = 0;

    bufs.forEach(function(b) {
      var src  = off.createBufferSource();
      var copy = off.createBuffer(1, b.length, sr);
      copy.getChannelData(0).set(b.getChannelData(0));
      src.buffer = copy;
      src.connect(off.destination);
      src.start(offset / sr);
      offset += b.length;
    });

    off.startRendering().then(function(rendered) {
      var wav = audioBufferToWav(rendered);
      triggerDownload(wav, 'lucier-iter'+from+'-'+to+'-x'+loops+'.wav');
      btn.disabled = false;
      progress.style.display = 'none';
      note.style.display     = 'inline';
    }).catch(function() {
      btn.disabled = false;
      progress.style.display = 'none';
      note.textContent = 'export failed';
      note.style.display = 'inline';
    });
  }

  /* ── Source loading ── */
  function loadGenerated() {
    lucierStop();
    lucier.sourceType = 'generated';
    lucier.hasRecording = false;
    setSourceUI('generated');
    setLucierStatus('generating…');
    document.getElementById('lucier-iterate').disabled = true;

    generateVoiceBuffer(getCtx()).then(function(buf) {
      normalizeBuffer(buf, 0.78);
      lucier.iterations  = [buf];
      lucier.currentIter = 0;
      document.getElementById('lucier-iterate').disabled = false;
      updateLucierDisplay();
      updateDownloadSelects();
      setLucierStatus('ready');
      lucierPlay();
    }).catch(function() { setLucierStatus('generation failed'); });
  }

  function loadAudioFile(file) {
    lucierStop();
    var reader = new FileReader();
    reader.onload = function(e) {
      getCtx().decodeAudioData(e.target.result, function(decoded) {
        normalizeBuffer(decoded, 0.78);
        lucier.sourceType = 'file';
        lucier.hasRecording = false;
        lucier.iterations  = [decoded];
        lucier.currentIter = 0;
        lucier.iterations = lucier.iterations.slice(0,1);
        document.getElementById('lucier-iterate').disabled = false;
        updateLucierDisplay();
        updateDownloadSelects();
        setSourceUI('file');
        setLucierStatus('loaded: ' + file.name.substring(0,24));
        lucierPlay();
      }, function() {
        setLucierStatus('could not decode file');
      });
    };
    reader.readAsArrayBuffer(file);
  }

  /* Mic recording */
  function startMicRecording() {
    if (lucier.isRecording) { stopMicRecording(); return; }
    navigator.mediaDevices.getUserMedia({ audio: true, video: false }).then(function(stream) {
      recChunks = [];
      mRec = new MediaRecorder(stream);
      mRec.ondataavailable = function(e) { if (e.data.size>0) recChunks.push(e.data); };
      mRec.onstop = function() {
        stream.getTracks().forEach(function(t){t.stop();});
        var blob = new Blob(recChunks, { type: 'audio/webm' });
        var fr   = new FileReader();
        fr.onload = function(ev) {
          getCtx().decodeAudioData(ev.target.result, function(decoded) {
            normalizeBuffer(decoded, 0.78);
            lucier.iterations  = [decoded];
            lucier.currentIter = 0;
            lucier.hasRecording = true;
            lucier.isRecording  = false;
            document.getElementById('lucier-iterate').disabled = false;
            updateLucierDisplay();
            updateDownloadSelects();
            setRecordingState('has_recording');
            setLucierStatus('ready');
            lucierPlay();
          }, function() { setLucierStatus('decode failed'); });
        };
        fr.readAsArrayBuffer(blob);
      };
      mRec.start();
      lucier.isRecording = true;
      setRecordingState('recording');
      setLucierStatus('recording… (max 6 seconds)');
      setTimeout(function() { if (lucier.isRecording) stopMicRecording(); }, 6000);
    }).catch(function() {
      setLucierStatus('mic access denied');
      setRecordingState('idle');
    });
  }

  function stopMicRecording() {
    if (mRec && lucier.isRecording) mRec.stop();
  }

  /* ── Source UI states ── */
  function setSourceUI(type) {
    document.getElementById('src-generated').classList.toggle('on', type==='generated');
    document.getElementById('src-mic').classList.toggle('on', type==='mic');
    document.getElementById('upload-label').classList.toggle('on', type==='file');
    /* Mic controls */
    var showMic = (type==='mic');
    document.getElementById('lucier-record').style.display   = showMic ? 'inline-block' : 'none';
    document.getElementById('rec-state-label').style.display = showMic && lucier.hasRecording ? 'inline' : 'none';
    document.getElementById('rec-new-btn').style.display     = showMic && lucier.hasRecording ? 'inline-block' : 'none';
    if (showMic && !lucier.hasRecording) setRecordingState('idle');
  }

  function setRecordingState(state) {
    var recBtn    = document.getElementById('lucier-record');
    var stateLabel = document.getElementById('rec-state-label');
    var newBtn    = document.getElementById('rec-new-btn');
    if (state === 'idle') {
      recBtn.innerHTML = '&#9679;&#xFE0E; record';
      recBtn.classList.remove('on');
      recBtn.style.display = 'inline-block';
      stateLabel.style.display = 'none';
      newBtn.style.display     = 'none';
    } else if (state === 'recording') {
      recBtn.innerHTML = '&#9632;&#xFE0E; stop';
      recBtn.classList.add('on');
      recBtn.style.display = 'inline-block';
      stateLabel.style.display = 'none';
      newBtn.style.display     = 'none';
    } else if (state === 'has_recording') {
      recBtn.style.display = 'none';
      stateLabel.textContent   = 'using recording';
      stateLabel.style.display = 'inline';
      newBtn.style.display     = 'inline-block';
    }
  }

  /* ════════════════════════════════
     RADIGUE MODULE
  ════════════════════════════════ */

  var radigue = {
    baseFreq:   110,
    detune:     2.5,
    driftRate:  0.07,
    noiseLevel: 0.03,
    numOscs:    3,
    isPlaying:  false
  };

  var rOscs = [], rLFOs = [], rMaster = null, rNoiseSrc = null, rNoiseGain = null;
  var rDispTimer = null;

  function startRadigue() {
    stopRadigue();
    var ctx = resumeCtx();
    rMaster = ctx.createGain(); rMaster.gain.value = 0.4;
    rMaster.connect(ctx.destination);

    var base = radigue.baseFreq, det = radigue.detune;
    var freqs = radigue.numOscs === 2 ? [base - det/2, base + det/2] : [base - det, base, base + det];

    freqs.forEach(function(freq, i) {
      var osc = ctx.createOscillator();
      osc.type = 'sine'; osc.frequency.value = freq;
      var og = ctx.createGain(); og.gain.value = 1/radigue.numOscs;
      osc.connect(og); og.connect(rMaster);

      var lfo     = ctx.createOscillator();
      var lfoGain = ctx.createGain();
      lfo.type = 'sine';
      lfo.frequency.value = radigue.driftRate * (0.6 + i * 0.35);
      lfoGain.gain.value  = det * 0.4;
      lfo.connect(lfoGain); lfoGain.connect(osc.frequency);
      osc.start(); lfo.start();
      rOscs.push(osc); rLFOs.push(lfo);
    });

    if (radigue.noiseLevel > 0) {
      var nb = makePinkNoise(ctx);
      rNoiseSrc = ctx.createBufferSource();
      rNoiseSrc.buffer = nb; rNoiseSrc.loop = true;
      rNoiseGain = ctx.createGain(); rNoiseGain.gain.value = radigue.noiseLevel;
      rNoiseSrc.connect(rNoiseGain); rNoiseGain.connect(rMaster);
      rNoiseSrc.start();
    }

    radigue.isPlaying = true;
    document.getElementById('radigue-play').innerHTML = '&#9632;&#xFE0E; stop';
    document.getElementById('radigue-play').classList.add('on');
    rDispTimer = setInterval(updateRadigueDisplay, 250);
    updateRadigueDisplay();
  }

  function stopRadigue() {
    rOscs.forEach(function(o){try{o.stop();}catch(e){}});
    rLFOs.forEach(function(l){try{l.stop();}catch(e){}});
    if (rNoiseSrc) { try{rNoiseSrc.stop();}catch(e){} rNoiseSrc=null; rNoiseGain=null; }
    rOscs=[]; rLFOs=[]; rMaster=null;
    if (rDispTimer) { clearInterval(rDispTimer); rDispTimer=null; }
    radigue.isPlaying = false;
    document.getElementById('radigue-play').innerHTML = '&#9654;&#xFE0E; play';
    document.getElementById('radigue-play').classList.remove('on');
  }

  function updateRadigueDisplay() {
    var ids = ['r-f1','r-f2','r-f3'];
    ids.forEach(function(id, i) {
      var el = document.getElementById(id);
      if (!el) return;
      el.textContent = rOscs[i] ? rOscs[i].frequency.value.toFixed(1)+' Hz' : '—';
    });
  }

  function restartRadigueIfPlaying() {
    if (radigue.isPlaying) { stopRadigue(); startRadigue(); }
  }

  function noiseLabel(v) {
    if (v < 0.005) return 'off';
    if (v < 0.04)  return 'low';
    if (v < 0.09)  return 'medium';
    return 'high';
  }

  /* ── Radigue download ── */
  function radiqueDownload() {
    var durMins = parseInt(document.getElementById('radigue-dl-dur').value, 10);
    var durSecs = durMins * 60;
    var sr      = 44100;
    var btn     = document.getElementById('radigue-dl-btn');
    var prog    = document.getElementById('radigue-dl-progress');

    btn.disabled = true;
    prog.style.display = 'inline';

    var off = new OfflineAudioContext(2, sr * durSecs, sr);
    var master = off.createGain(); master.gain.value = 0.4;
    master.connect(off.destination);

    var base = radigue.baseFreq, det = radigue.detune;
    var freqs = radigue.numOscs === 2 ? [base - det/2, base + det/2] : [base - det, base, base + det];

    freqs.forEach(function(freq, i) {
      var osc = off.createOscillator();
      osc.type = 'sine'; osc.frequency.value = freq;
      var og = off.createGain(); og.gain.value = 1/radigue.numOscs;
      osc.connect(og); og.connect(master);

      var lfo = off.createOscillator();
      var lfoG = off.createGain();
      lfo.type = 'sine';
      lfo.frequency.value = radigue.driftRate * (0.6 + i * 0.35);
      lfoG.gain.value = det * 0.4;
      lfo.connect(lfoG); lfoG.connect(osc.frequency);
      osc.start(0); lfo.start(0);
    });

    if (radigue.noiseLevel > 0) {
      /* Tile pink noise buffer to full duration */
      var noiseBuf   = makePinkNoise(off);
      var tileSamples = noiseBuf.length;
      var totalSamples = sr * durSecs;
      var fullBuf    = off.createBuffer(1, totalSamples, sr);
      var fullData   = fullBuf.getChannelData(0);
      var srcData    = noiseBuf.getChannelData(0);
      for (var i = 0; i < totalSamples; i++) fullData[i] = srcData[i % tileSamples];
      var nSrc = off.createBufferSource(); nSrc.buffer = fullBuf;
      var nGain = off.createGain(); nGain.gain.value = radigue.noiseLevel;
      nSrc.connect(nGain); nGain.connect(master);
      nSrc.start(0);
    }

    off.startRendering().then(function(rendered) {
      var wav = audioBufferToWav(rendered);
      triggerDownload(wav, 'radigue-drone-'+durMins+'min.wav');
      btn.disabled = false;
      prog.style.display = 'none';
    }).catch(function() {
      btn.disabled = false;
      prog.style.display = 'none';
    });
  }

  /* ════════════════════════════════
     INIT
  ════════════════════════════════ */
  function init() {

    /* Lucier source */
    document.getElementById('src-generated').addEventListener('click', function() {
      setSourceUI('generated');
      loadGenerated();
    });

    document.getElementById('src-mic').addEventListener('click', function() {
      lucier.sourceType = 'mic';
      lucier.hasRecording = false;
      setSourceUI('mic');
      lucierStop();
      lucier.iterations = [];
      updateLucierDisplay();
      updateDownloadSelects();
      setLucierStatus('press record and speak');
    });

    document.getElementById('lucier-file-input').addEventListener('change', function(e) {
      if (e.target.files && e.target.files[0]) loadAudioFile(e.target.files[0]);
    });

    document.getElementById('lucier-record').addEventListener('click', startMicRecording);
    document.getElementById('rec-new-btn').addEventListener('click', function() {
      lucier.hasRecording = false;
      lucier.iterations = [];
      lucierStop();
      updateLucierDisplay();
      updateDownloadSelects();
      setRecordingState('idle');
      setLucierStatus('press record and speak');
    });

    document.getElementById('lucier-play').addEventListener('click', function() {
      if (lucier.isPlaying) { lucierStop(); } else { lucierPlay(); }
    });

    document.getElementById('lucier-loop').addEventListener('click', function() {
      lucier.isLooping = !lucier.isLooping;
      this.classList.toggle('on', lucier.isLooping);
      if (lSrc) lSrc.loop = lucier.isLooping;
    });

    document.getElementById('lucier-iterate').addEventListener('click', lucierIterate);
    document.getElementById('lucier-reset').addEventListener('click', lucierReset);

    document.getElementById('lucier-dl-btn').addEventListener('click', lucierDownload);

    ['lucier-dl-from','lucier-dl-to','lucier-dl-loops'].forEach(function(id) {
      document.getElementById(id).addEventListener('change', function() {
        var note = document.getElementById('lucier-dl-note');
        if (lucier.iterations.length > 1) note.textContent = 'approx ' + estimateLucierSize() + ' MB';
      });
    });

    /* Radigue sliders */
    document.getElementById('r-base').addEventListener('input', function(e) {
      radigue.baseFreq = parseInt(e.target.value, 10);
      document.getElementById('r-base-val').textContent = radigue.baseFreq + ' Hz';
      restartRadigueIfPlaying();
    });
    document.getElementById('r-detune').addEventListener('input', function(e) {
      radigue.detune = parseFloat(e.target.value);
      document.getElementById('r-detune-val').textContent = radigue.detune + ' Hz';
      restartRadigueIfPlaying();
    });
    document.getElementById('r-drift').addEventListener('input', function(e) {
      radigue.driftRate = parseFloat(e.target.value);
      document.getElementById('r-drift-val').textContent = radigue.driftRate.toFixed(2);
      restartRadigueIfPlaying();
    });
    document.getElementById('r-noise').addEventListener('input', function(e) {
      radigue.noiseLevel = parseFloat(e.target.value);
      document.getElementById('r-noise-val').textContent = noiseLabel(radigue.noiseLevel);
      restartRadigueIfPlaying();
    });

    document.querySelectorAll('[data-oscs]').forEach(function(btn) {
      btn.addEventListener('click', function() {
        radigue.numOscs = parseInt(btn.getAttribute('data-oscs'), 10);
        document.querySelectorAll('[data-oscs]').forEach(function(b){ b.classList.toggle('on', b===btn); });
        /* show/hide osc 3 display */
        var f3 = document.getElementById('r-f3');
        if (f3) f3.closest('.radigue-freq-col').style.visibility = radigue.numOscs===3 ? 'visible' : 'hidden';
        restartRadigueIfPlaying();
      });
    });

    document.getElementById('radigue-play').addEventListener('click', function() {
      if (radigue.isPlaying) { stopRadigue(); } else { startRadigue(); }
    });

    document.getElementById('radigue-dl-btn').addEventListener('click', radiqueDownload);

    /* Init Lucier */
    loadGenerated();
    updateDownloadSelects();
  }

  init();

}());
