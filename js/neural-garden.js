/* ════════════════════════════════════════════════════════════════
   NEURAL GARDEN — a self-learning network rendered as sound + creature
   Single file, organized in sections. No dependency on any other lab
   on this site — this engine is built from scratch for this page.
   ════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  /* ── 1. CONSTANTS ────────────────────────────────────────────── */
  const MAX_NODES        = 24;
  const NODE_RADIUS       = 13;
  const HIT_RADIUS        = 16;

  const HEBBIAN_RATE      = 0.045;   // how fast co-active connections strengthen
  const WEIGHT_DECAY      = 0.012;   // passive decay applied every tick
  const WEIGHT_MAX        = 1.0;
  const PRUNE_FLOOR        = 0.04;   // connections below this (after a grace period) are removed
  const CONN_GRACE_TICKS  = 40;      // ~4s grace before a fresh connection can be pruned

  const SPONTANEOUS_CHECK_EVERY = 30;  // ticks between scans for spontaneous connections
  const SPONTANEOUS_BASE_PROB   = 0.05;

  const TICK_MS           = 100;     // network simulation tick — never pauses
  const N_OSC_VOICES       = 6;      // hard cap on simultaneous audible oscillator voices
  const N_LFO_VOICES       = 3;      // hard cap on simultaneous lfo modulation voices

  const CONSONANT_CENTS   = [0, 200, 400, 500, 700, 900, 1100];
  const CONSONANCE_WIDTH  = 60; // cents — falloff width around each consonant target

  const TYPE_COLOR = { osc: '#2C5F8A', mod: '#8A5A2C', lfo: '#4F7A4A' };

  /* ── 2. DOM REFS ─────────────────────────────────────────────── */
  const graphCanvas    = document.getElementById('ng-graph');
  const gctx           = graphCanvas.getContext('2d');
  const creatureCanvas = document.getElementById('ng-creature');
  const cctx           = creatureCanvas.getContext('2d');

  const btnModePlace   = document.getElementById('btn-mode-place');
  const btnModeConnect = document.getElementById('btn-mode-connect');
  const btnModeRemove  = document.getElementById('btn-mode-remove');
  const selType        = document.getElementById('sel-type');
  const selAct         = document.getElementById('sel-act');
  const btnPlay        = document.getElementById('btn-play');
  const btnReset       = document.getElementById('btn-reset');
  const volSlider       = document.getElementById('vol-slider');
  const volVal          = document.getElementById('vol-val');

  const statNodes      = document.getElementById('stat-nodes');
  const statConns      = document.getElementById('stat-conns');
  const statMood        = document.getElementById('stat-mood');
  const statAge          = document.getElementById('stat-age');
  const creatureCaption = document.getElementById('creature-caption');

  const curriculum       = document.getElementById('curriculum');
  const curriculumToggle = document.getElementById('curriculum-toggle');

  /* ── 3. STATE ────────────────────────────────────────────────── */
  let nodes = [];          // {id,x,y,type,act,freqBase,phase,phaseRate,drive,activation}
  let connections = [];    // {id,a,b,weight,age,spontaneous}
  let nextNodeId = 1;
  let nextConnId = 1;

  let uiMode = 'place';    // place | connect | remove
  let selectedNodeId = null;

  let mood = 0.6;          // 0 (rough) .. 1 (consonant)
  let avgActivation = 0;

  let sessionStartMs = performance.now();
  let totalConnectionsFormed = 0;
  let spontaneousConnectionsFormed = 0;
  let firstSpontaneousAt = null;

  let isPlaying = false;
  let masterVolume = 0.6;

  /* ── 4. NODE / CONNECTION FACTORIES ─────────────────────────── */
  function yToFreq(y, h) {
    // higher on canvas = higher pitch. Map across roughly 3 octaves.
    const norm = 1 - Math.max(0, Math.min(1, y / h));
    return 110 * Math.pow(8, norm); // 110Hz .. ~880Hz range-ish (8x over span)
  }

  function makeNode(x, y, type, act) {
    const h = graphCanvas.height || 360;
    return {
      id: nextNodeId++,
      x, y, type, act,
      freqBase: type === 'osc' ? yToFreq(y, h) : null,
      phase: Math.random() * Math.PI * 2,
      phaseRate: 0.15 + Math.random() * 0.5,   // intrinsic drive speed
      drive: 0.5 + Math.random() * 0.5,         // how strongly its own rhythm matters
      activation: 0,
      bornAt: nowSeconds(),
    };
  }

  function makeConnection(aId, bId, spontaneous) {
    return {
      id: nextConnId++,
      a: aId, b: bId,
      weight: spontaneous ? 0.12 : 0.22,
      age: 0,
      spontaneous: !!spontaneous,
    };
  }

  function nowSeconds() { return (performance.now() - sessionStartMs) / 1000; }

  function findNode(id) { return nodes.find(n => n.id === id); }

  function connectionExists(aId, bId) {
    return connections.some(c => (c.a === aId && c.b === bId) || (c.a === bId && c.b === aId));
  }

  /* ── 5. NETWORK ENGINE (the actual learning) ───────────────────
     Runs every tick regardless of audio/visibility state. */
  let tickCount = 0;

  function networkTick() {
    tickCount++;

    // 5a. advance each node's intrinsic oscillation + propagate weighted input
    for (const n of nodes) {
      n.phase += n.phaseRate * (TICK_MS / 1000);
      const intrinsic = Math.sin(n.phase) * n.drive;

      let incoming = 0;
      for (const c of connections) {
        if (c.b === n.id) {
          const src = findNode(c.a);
          if (src) incoming += src.activation * c.weight;
        } else if (c.a === n.id) {
          const src = findNode(c.b);
          if (src) incoming += src.activation * c.weight * 0.6; // connections carry influence both ways, asymmetrically
        }
      }

      const raw = intrinsic * 0.6 + incoming;
      n.activation = applyActivation(raw, n.act);
    }

    // 5b. Hebbian weight update + decay
    for (const c of connections) {
      const a = findNode(c.a), b = findNode(c.b);
      if (!a || !b) continue;
      const coActivity = Math.abs(a.activation) * Math.abs(b.activation);
      c.weight += HEBBIAN_RATE * coActivity - WEIGHT_DECAY * c.weight;
      c.weight = Math.max(0, Math.min(WEIGHT_MAX, c.weight));
      c.age++;
    }

    // 5c. prune dead connections
    connections = connections.filter(c => !(c.age > CONN_GRACE_TICKS && c.weight < PRUNE_FLOOR));

    // 5d. consonance / mood
    mood = computeMood();
    avgActivation = nodes.length
      ? nodes.reduce((s, n) => s + Math.abs(n.activation), 0) / nodes.length
      : 0;

    // 5e. mood-shaped gentle pitch correction toward consonant intervals
    applyConsonanceCorrection();

    // 5f. spontaneous connection formation, biased by mood
    if (tickCount % SPONTANEOUS_CHECK_EVERY === 0) {
      maybeFormSpontaneousConnection();
    }

    updateStatsUI();
  }

  function applyActivation(x, act) {
    if (act === 'relu') {
      return x > 0.18 ? Math.min(1, x) : 0;
    }
    if (act === 'sigmoid') {
      return 1 / (1 + Math.exp(-4 * x));
    }
    // tanh — can swing both directions
    return Math.tanh(x * 1.6);
  }

  function computeMood() {
    const active = nodes.filter(n => n.type === 'osc' && Math.abs(n.activation) > 0.2 && n.freqBase);
    if (active.length < 2) return 0.65; // neutral default — nothing to clash
    let total = 0, count = 0;
    for (let i = 0; i < active.length; i++) {
      for (let j = i + 1; j < active.length; j++) {
        const cents = 1200 * Math.log2(active[j].freqBase / active[i].freqBase);
        const modCents = ((cents % 1200) + 1200) % 1200;
        let best = Infinity;
        for (const target of CONSONANT_CENTS) {
          best = Math.min(best, Math.abs(modCents - target));
        }
        const score = Math.max(0, 1 - best / CONSONANCE_WIDTH);
        total += score;
        count++;
      }
    }
    return count ? total / count : 0.65;
  }

  function applyConsonanceCorrection() {
    const active = nodes.filter(n => n.type === 'osc' && Math.abs(n.activation) > 0.2 && n.freqBase);
    if (active.length < 2) return;
    // anchor = currently most active oscillator
    let anchor = active[0];
    for (const n of active) if (Math.abs(n.activation) > Math.abs(anchor.activation)) anchor = n;

    const correctionStrength = (1 - mood) * 0.004; // gentle — self-correcting, not snapping
    for (const n of active) {
      if (n === anchor) continue;
      const cents = 1200 * Math.log2(n.freqBase / anchor.freqBase);
      const modCents = ((cents % 1200) + 1200) % 1200;
      let bestTarget = CONSONANT_CENTS[0], bestDist = Infinity;
      for (const t of CONSONANT_CENTS) {
        const d = Math.abs(modCents - t);
        if (d < bestDist) { bestDist = d; bestTarget = t; }
      }
      const targetFreq = anchor.freqBase * Math.pow(2, bestTarget / 1200);
      n.freqBase += (targetFreq - n.freqBase) * correctionStrength;
    }
  }

  function maybeFormSpontaneousConnection() {
    if (nodes.length < 3 || connections.length >= MAX_NODES * 2) return;
    const candidates = [];
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i], b = nodes[j];
        if (connectionExists(a.id, b.id)) continue;
        const coAlign = Math.abs(a.activation) * Math.abs(b.activation);
        if (coAlign > 0.15) candidates.push({ a, b, coAlign });
      }
    }
    if (!candidates.length) return;
    candidates.sort((x, y) => y.coAlign - x.coAlign);
    const top = candidates[0];
    const prob = SPONTANEOUS_BASE_PROB + mood * 0.12; // more likely when things sound good
    if (Math.random() < prob) {
      const conn = makeConnection(top.a.id, top.b.id, true);
      connections.push(conn);
      totalConnectionsFormed++;
      spontaneousConnectionsFormed++;
      if (firstSpontaneousAt === null) firstSpontaneousAt = nowSeconds();
    }
  }

  /* ── 6. AUDIO ENGINE ─────────────────────────────────────────── */
  let audioCtx = null;
  let masterGain = null;
  let oscVoices = []; // {nodeId, osc, filter, gain}
  let lfoVoices = []; // {nodeId, osc, gain}

  function initAudio() {
    if (audioCtx) return;
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    masterGain = audioCtx.createGain();
    masterGain.gain.value = masterVolume;
    masterGain.connect(audioCtx.destination);
  }

  function audioEngineUpdate() {
    if (!isPlaying || !audioCtx) return;
    const t = audioCtx.currentTime + 0.02;

    // -- pick top oscillator voices by audibility --
    const oscCandidates = nodes
      .filter(n => n.type === 'osc' && Math.abs(n.activation) > 0.12)
      .sort((a, b) => Math.abs(b.activation) - Math.abs(a.activation))
      .slice(0, N_OSC_VOICES);

    const keepIds = new Set(oscCandidates.map(n => n.id));
    // release voices no longer needed
    oscVoices = oscVoices.filter(v => {
      if (keepIds.has(v.nodeId)) return true;
      v.gain.gain.setTargetAtTime(0, t, 0.4);
      setTimeout(() => { try { v.osc.stop(); v.osc.disconnect(); v.filter.disconnect(); v.gain.disconnect(); } catch (e) {} }, 900);
      return false;
    });

    // create voices for newly active nodes
    for (const n of oscCandidates) {
      if (oscVoices.some(v => v.nodeId === n.id)) continue;
      const osc = audioCtx.createOscillator();
      const filter = audioCtx.createBiquadFilter();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.value = n.freqBase || 220;
      filter.type = 'lowpass';
      filter.frequency.value = 1200;
      filter.Q.value = 0.6;
      gain.gain.value = 0;
      osc.connect(filter); filter.connect(gain); gain.connect(masterGain);
      osc.start();
      oscVoices.push({ nodeId: n.id, osc, filter, gain });
    }

    // update live voices: frequency, gain, filter (from connected timbre nodes)
    for (const v of oscVoices) {
      const n = findNode(v.nodeId);
      if (!n) continue;
      v.osc.frequency.setTargetAtTime(n.freqBase || 220, t, 0.08);
      const level = Math.max(0, Math.min(1, Math.abs(n.activation))) * 0.22; // per-voice cap keeps headroom
      v.gain.gain.setTargetAtTime(level, t, 0.06);

      let timbreInfluence = 0;
      for (const c of connections) {
        const otherId = c.a === n.id ? c.b : (c.b === n.id ? c.a : null);
        if (otherId === null) continue;
        const other = findNode(otherId);
        if (other && other.type === 'mod') {
          timbreInfluence += Math.abs(other.activation) * c.weight;
        }
      }
      const cutoff = 260 * Math.pow(28, Math.max(0, Math.min(1, timbreInfluence)));
      v.filter.frequency.setTargetAtTime(cutoff, t, 0.1);
    }

    // -- lfo voices --
    const lfoCandidates = nodes
      .filter(n => n.type === 'lfo' && Math.abs(n.activation) > 0.12)
      .sort((a, b) => Math.abs(b.activation) - Math.abs(a.activation))
      .slice(0, N_LFO_VOICES);
    const keepLfoIds = new Set(lfoCandidates.map(n => n.id));
    lfoVoices = lfoVoices.filter(v => {
      if (keepLfoIds.has(v.nodeId)) return true;
      v.gain.gain.setTargetAtTime(0, t, 0.3);
      setTimeout(() => { try { v.osc.stop(); v.osc.disconnect(); v.gain.disconnect(); } catch (e) {} }, 700);
      return false;
    });
    for (const n of lfoCandidates) {
      if (lfoVoices.some(v => v.nodeId === n.id)) continue;
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.value = 1.5;
      gain.gain.value = 0;
      osc.connect(gain);
      osc.start();
      lfoVoices.push({ nodeId: n.id, osc, gain });
    }
    for (const v of lfoVoices) {
      const n = findNode(v.nodeId);
      if (!n) continue;
      v.osc.frequency.setTargetAtTime(0.3 + Math.abs(n.activation) * 5.5, t, 0.2);
      // disconnect & rewire gain to current connected, currently-audible oscillator voices
      try { v.gain.disconnect(); } catch (e) {}
      let depth = 0;
      for (const c of connections) {
        const otherId = c.a === n.id ? c.b : (c.b === n.id ? c.a : null);
        if (otherId === null) continue;
        const targetVoice = oscVoices.find(ov => ov.nodeId === otherId);
        if (targetVoice) {
          v.gain.connect(targetVoice.osc.frequency);
          depth = Math.max(depth, c.weight);
        }
      }
      v.gain.gain.setTargetAtTime(depth * Math.abs(n.activation) * 14, t, 0.15);
    }
  }

  function stopAllAudio() {
    for (const v of oscVoices) { try { v.gain.gain.value = 0; v.osc.stop(); v.osc.disconnect(); v.filter.disconnect(); v.gain.disconnect(); } catch (e) {} }
    for (const v of lfoVoices) { try { v.gain.gain.value = 0; v.osc.stop(); v.osc.disconnect(); v.gain.disconnect(); } catch (e) {} }
    oscVoices = []; lfoVoices = [];
  }

  /* ── 7. CREATURE ENGINE ─────────────────────────────────────── */
  const CAPTIONS = ['a single cell', 'first stirrings', 'budding limbs', 'taking shape', 'alert and reactive', 'fully grown'];

  function milestoneLevel() {
    const ageMin = nowSeconds() / 60;
    const nc = nodes.length, cc = connections.length;
    if (nc < 2) return 0;
    if (nc >= 2 && cc < 1) return 1;
    if (cc >= 1 && cc < 3 && ageMin < 2) return 1;
    if (cc >= 3 || ageMin >= 2) {
      if (cc >= 10 || ageMin >= 10) {
        if (spontaneousConnectionsFormed >= 1) return 5;
        return 4;
      }
      if (cc >= 6 || ageMin >= 5) return 3;
      return 2;
    }
    return 1;
  }

  function drawCreature(level, pulse) {
    const W = creatureCanvas.width, H = creatureCanvas.height;
    cctx.clearRect(0, 0, W, H);
    const cx = W / 2, cy = H / 2 + 10;
    const baseR = 20 + level * 6 + pulse * 4;
    const wobble = Math.sin(nowSeconds() * 1.6) * 2;

    cctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--creature').trim() || '#C98A2E';

    // body — slightly irregular blob via perturbed circle
    cctx.beginPath();
    const segs = 24;
    for (let i = 0; i <= segs; i++) {
      const ang = (i / segs) * Math.PI * 2;
      const r = baseR + Math.sin(ang * 3 + nowSeconds() * 0.8) * (1.5 + level * 0.4) + wobble * 0.3;
      const px = cx + Math.cos(ang) * r;
      const py = cy + Math.sin(ang) * r * 0.92;
      if (i === 0) cctx.moveTo(px, py); else cctx.lineTo(px, py);
    }
    cctx.closePath();
    cctx.fill();

    // limb buds — count grows with level
    const limbCount = Math.max(0, level - 1) * 2;
    for (let i = 0; i < limbCount; i++) {
      const ang = (i / limbCount) * Math.PI * 2 + nowSeconds() * 0.1;
      const dist = baseR + 6 + Math.sin(nowSeconds() * 1.3 + i) * 2;
      const lx = cx + Math.cos(ang) * dist;
      const ly = cy + Math.sin(ang) * dist * 0.92;
      const lr = 4 + level * 0.6;
      cctx.beginPath();
      cctx.arc(lx, ly, lr, 0, Math.PI * 2);
      cctx.fill();
    }

    // eyes appear once fully grown
    if (level >= 5) {
      const bg = getComputedStyle(document.body).backgroundColor || '#fff';
      cctx.fillStyle = bg;
      cctx.beginPath(); cctx.arc(cx - 7, cy - 6, 3, 0, Math.PI * 2); cctx.fill();
      cctx.beginPath(); cctx.arc(cx + 7, cy - 6, 3, 0, Math.PI * 2); cctx.fill();
    }
  }

  /* ── 8. SCHEDULING — network sim never pauses, even backgrounded ──
     Uses a self-correcting setTimeout chain rather than rAF, since rAF
     is throttled to near-zero in background tabs. We measure real
     elapsed wall-clock time each invocation and, if the engine was
     throttled while backgrounded, run extra catch-up ticks so growth
     genuinely continues rather than just resuming from where it paused. */
  let lastTickTime = performance.now();

  function scheduleTick() {
    setTimeout(() => {
      const now = performance.now();
      let elapsed = now - lastTickTime;
      lastTickTime = now;
      const ticksOwed = Math.min(50, Math.max(1, Math.round(elapsed / TICK_MS)));
      for (let i = 0; i < ticksOwed; i++) networkTick();
      audioEngineUpdate();
      scheduleTick();
    }, TICK_MS);
  }

  /* ── 9. RENDER LOOP (visual only — reads state, draws it) ─────── */
  function render() {
    drawGraph();
    const level = milestoneLevel();
    drawCreature(level, avgActivation);
    creatureCaption.textContent = CAPTIONS[level];
    requestAnimationFrame(render);
  }

  function drawGraph() {
    const W = graphCanvas.width, H = graphCanvas.height;
    gctx.clearRect(0, 0, W, H);

    // connections
    for (const c of connections) {
      const a = findNode(c.a), b = findNode(c.b);
      if (!a || !b) continue;
      gctx.strokeStyle = 'rgba(80,80,80,' + (0.15 + c.weight * 0.6) + ')';
      gctx.lineWidth = 0.6 + c.weight * 4;
      gctx.beginPath();
      gctx.moveTo(a.x, a.y);
      gctx.lineTo(b.x, b.y);
      gctx.stroke();
    }

    // nodes
    for (const n of nodes) {
      const pulse = Math.abs(n.activation) * 6;
      gctx.fillStyle = TYPE_COLOR[n.type];
      gctx.globalAlpha = n.id === selectedNodeId ? 1 : 0.92;
      gctx.beginPath();
      gctx.arc(n.x, n.y, NODE_RADIUS + pulse, 0, Math.PI * 2);
      gctx.fill();
      gctx.globalAlpha = 1;
      if (n.id === selectedNodeId) {
        gctx.strokeStyle = '#111';
        gctx.lineWidth = 2;
        gctx.beginPath();
        gctx.arc(n.x, n.y, NODE_RADIUS + pulse + 4, 0, Math.PI * 2);
        gctx.stroke();
      }
    }
  }

  /* ── 10. STATS / STATUS UI ──────────────────────────────────── */
  const MOOD_LABELS = [[0.25, 'restless'], [0.45, 'searching'], [0.65, 'settled'], [1.01, 'warm']];
  function moodLabel(m) {
    for (const [thresh, label] of MOOD_LABELS) if (m < thresh) return label;
    return 'warm';
  }

  function updateStatsUI() {
    statNodes.textContent = nodes.length;
    statConns.textContent = connections.length;
    statMood.textContent = moodLabel(mood);
    const secs = Math.floor(nowSeconds());
    const mm = Math.floor(secs / 60), ss = secs % 60;
    statAge.textContent = mm + ':' + String(ss).padStart(2, '0');
    btnModePlace.disabled = nodes.length >= MAX_NODES && uiMode === 'place';
  }

  /* ── 11. UI WIRING ──────────────────────────────────────────── */
  function setMode(m) {
    uiMode = m;
    selectedNodeId = null;
    btnModePlace.classList.toggle('active', m === 'place');
    btnModeConnect.classList.toggle('active', m === 'connect');
    btnModeRemove.classList.toggle('active', m === 'remove');
  }
  btnModePlace.addEventListener('click', () => setMode('place'));
  btnModeConnect.addEventListener('click', () => setMode('connect'));
  btnModeRemove.addEventListener('click', () => setMode('remove'));

  function getCanvasPos(e, canvas) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const src = e.touches ? e.touches[0] : e;
    return { x: (src.clientX - rect.left) * scaleX, y: (src.clientY - rect.top) * scaleY };
  }

  function nodeAt(x, y) {
    let best = null, bestDist = HIT_RADIUS;
    for (const n of nodes) {
      const d = Math.hypot(n.x - x, n.y - y);
      if (d < bestDist) { bestDist = d; best = n; }
    }
    return best;
  }

  function handleGraphClick(e) {
    e.preventDefault();
    const { x, y } = getCanvasPos(e, graphCanvas);
    const hit = nodeAt(x, y);

    if (uiMode === 'place') {
      if (hit) return; // don't stack nodes
      if (nodes.length >= MAX_NODES) return;
      const n = makeNode(x, y, selType.value, selAct.value);
      nodes.push(n);
      updateStatsUI();
      return;
    }

    if (uiMode === 'connect') {
      if (!hit) { selectedNodeId = null; return; }
      if (selectedNodeId === null) { selectedNodeId = hit.id; return; }
      if (selectedNodeId === hit.id) { selectedNodeId = null; return; }
      if (!connectionExists(selectedNodeId, hit.id)) {
        connections.push(makeConnection(selectedNodeId, hit.id, false));
        totalConnectionsFormed++;
      }
      selectedNodeId = null;
      updateStatsUI();
      return;
    }

    if (uiMode === 'remove') {
      if (!hit) return;
      nodes = nodes.filter(n => n.id !== hit.id);
      connections = connections.filter(c => c.a !== hit.id && c.b !== hit.id);
      updateStatsUI();
    }
  }
  graphCanvas.addEventListener('mousedown', handleGraphClick);
  graphCanvas.addEventListener('touchstart', handleGraphClick, { passive: false });

  btnPlay.addEventListener('click', () => {
    if (isPlaying) {
      isPlaying = false;
      btnPlay.textContent = 'play';
      btnPlay.classList.remove('active');
      stopAllAudio();
    } else {
      initAudio();
      if (audioCtx.state === 'suspended') audioCtx.resume();
      isPlaying = true;
      btnPlay.textContent = 'stop';
      btnPlay.classList.add('active');
    }
  });

  btnReset.addEventListener('click', () => {
    stopAllAudio();
    nodes = []; connections = [];
    selectedNodeId = null;
    sessionStartMs = performance.now();
    totalConnectionsFormed = 0; spontaneousConnectionsFormed = 0; firstSpontaneousAt = null;
    tickCount = 0;
    updateStatsUI();
  });

  volSlider.addEventListener('input', () => {
    masterVolume = parseInt(volSlider.value, 10) / 100;
    volVal.textContent = volSlider.value + '%';
    if (masterGain && audioCtx) masterGain.gain.setTargetAtTime(masterVolume, audioCtx.currentTime, 0.05);
  });

  curriculumToggle.addEventListener('click', () => {
    curriculum.classList.toggle('open');
  });

  /* ── 12. CANVAS SIZING ──────────────────────────────────────── */
  function resizeCanvases() {
    const gWrap = graphCanvas.parentElement;
    graphCanvas.width = gWrap.clientWidth;
    graphCanvas.height = graphCanvas.clientHeight;

    const cWrap = creatureCanvas.parentElement;
    creatureCanvas.width = cWrap.clientWidth;
    creatureCanvas.height = creatureCanvas.clientHeight;
  }
  window.addEventListener('resize', resizeCanvases);
  resizeCanvases();

  /* ── 13. BOOT ───────────────────────────────────────────────── */
  updateStatsUI();
  scheduleTick();      // network simulation — runs forever, never pauses
  requestAnimationFrame(render); // visuals — naturally idles while backgrounded

})();
