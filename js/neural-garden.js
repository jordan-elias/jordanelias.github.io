/* ════════════════════════════════════════════════════════════════
   NEURAL GARDEN — neural-garden.js
   Neural network soundscape + ASCII creature companion.
   Sections: 1·Sprites  2·Constants  3·DOM  4·State  5·Factories
             6·Network  7·Audio  8·Creature  9·ActFn graphs
            10·Tick  11·Render  12·Stats  13·Pointer  14·UI
            15·Canvas  16·Boot
   ════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  /* ═══════════════════════════════════════════════════════════════
     1 · SPRITE DATA
     wander:true  → creature moves freely (stages 0-5).
     wander:false → creature stays centered, sprite frames cycle.
     Mood keys: neutral | happy | sad | alert | fire
     Adding future stages: append entries to STAGES array only.
     ═══════════════════════════════════════════════════════════════ */

  const STAGES = [

    /* ── 0: nothing placed yet ─────────────────────────────────── */
    { fontSize: 14, wander: false, caption: 'waiting',
      neutral: ['·'] },

    /* ── 1: first node ─────────────────────────────────────────── */
    { fontSize: 28, wander: true, speed: 80, caption: 'a single cell',
      left: ['o'], right: ['o'], still: ['o'] },

    /* ── 2: second node ────────────────────────────────────────── */
    { fontSize: 24, wander: true, speed: 74, caption: 'dividing',
      left: ['(o)'], right: ['(o)'], still: ['(o)'] },

    /* ── 3: first connection ───────────────────────────────────── */
    { fontSize: 22, wander: true, speed: 66, caption: 'first connection',
      left: ['(o)~~'], right: ['~~(o)'], still: ['(o)'] },

    /* ── 4: 3 connections ──────────────────────────────────────── */
    { fontSize: 20, wander: true, speed: 55, caption: 'beginning to feel',
      left: ['(· ·)~~'], right: ['~~(· ·)'], still: ['(· ·)'] },

    /* ── 5: 5 connections ──────────────────────────────────────── */
    { fontSize: 18, wander: true, speed: 42, caption: 'something like a face',
      left: ['(° ‿ °)~~~'], right: ['~~~(° ‿ °)'], still: ['(° ‿ °)'] },

    /* ── 6: 8+ connections or 3+ min ───────────────────────────── */
    { fontSize: 18, wander: false, caption: 'finding its limbs',
      neutral: ['>(• ‿ •)<',  '> (• ‿ •) <'],
      happy:   ['>(^ ‿ ^)<',   '> (^ ‿ ^) <'],
      sad:     ['>(° ︵ °)<'],
      alert:   ['>(◉ ‿ ◉)<',  '> (◉ ‿ ◉) <'] },

    /* ── 7: 11+ connections or 6+ min ──────────────────────────── */
    { fontSize: 16, wander: false, caption: 'something like a horn',
      neutral: [
`   .-^-.
  (• ‿ •)
  >(~~~)<`,
`   .-^-.
  (• ‿ •)
 > (~~~) <`,
`   .-^-.
  (o‿ o )
  >(~~~)<`,
`   .-^-.
  ( o ‿o)
  >(~~~)<`,
`   .-^-.
  ( o ‿o)
 > (~~~) <`],
      happy: [
`   .-^-.
  (o ◡ o)
  >(~~~)<`,
`   .-^-.
  (^ ◡ ^)
  >(~~~)<`,
`   .-^-.
  (o ◡ o)
 > (~~~) <`],
      sad: [
`   .-^-.
  (° ︵ °)
  >(~~~)<`],
      alert: [
`    .-^-.
  (◉ ◡ ◉)
   >(~~~)<`] },

    /* ── 8: 14+ connections or 10+ min ─────────────────────────── */
    { fontSize: 15, wander: false, caption: 'winged and watching',
      neutral: [
`   >.-^-.<
  (◉ ‿ ◉)
  >(≈≈≈≈)<
    ◜  ◝`,
`   >.-^-.<
  (◉‿ ◉ )
  >(≈≈≈≈)<
   ◜   ◝`,
`   >.-^-.<
  ( ◉ ‿◉)
  >(≈≈≈≈)<
   ◜   ◝`],
      happy: [
`   >.-^-.<
  (^ ‿ ^)
  >(≈≈≈≈)<
   ◜   ◝`],
      sad: [
`   >.-^-.<
  (- ︵ -)
  >(≈≈≈≈)<
   ◜   ◝`],
      alert: [
`   >.-^-.<
  (◉ ‿ ◉)
  >(≈≈≈≈)<
    ◜  ◝`] },

    /* ── 9: 18+ connections or 16+ min ─────────────────────────── */
    { fontSize: 13, wander: false, caption: 'walking on four legs',
      neutral: [
`         /\\___/\\
   °◝   (◉ ◡ ◉)
      ) m-(    )-m
     (__ m◜  ◝m`,
`          /\\___/\\
   °◝    ( ◉  ◉)
      \\  m   \`\`   m
       )  \\(    )/
      (__ m◜  ◝m`,
`          /\\___/\\
         (◉  ◉ )    ◜°
        m  \`\`    m  /
         \\(    )/  (
         m◜  ◝m ___)`,
`          /\\___/\\
         (◉◡ ◉ )    ◜°
        m◜(    )◝m  (
          m◜  ◝m  ___)`],
      happy: [
`         /\\___/\\
   °◝    ( ^ ‿^)
      ) m-(    )-m
     (__ m◜  ◝m`,
`         /\\___/\\
         (^‿ ^ )   ◜°
        m-(    )-m (
         m◜  ◝m __ )`],
      sad: [
`         /\\___/\\
   °◝   (° ︵ °)
      ) m-(    )-m
     (__ m◜  ◝m`],
      alert: [
`         /\\___/\\
   °◝   (◉ ◡ ◉)
      ) m-(    )-m
     (__ m◜  ◝m`] },

    /* ── 10: 22+ connections or 23+ min ────────────────────────── */
    { fontSize: 12, wander: false, caption: 'growing into its body',
      neutral: [
`     /\\___/\\
    ( ◉  ◉ )_/_/_/_
       ´´    ~~~~~~~\\_____,=~
    / /  / /  \\  \\  \\
   (_/  (_/   (_/ (_/`,
`     /\\___/\\
    (◉ ◉  )_/_/_/_
      ´´    ~~~~~~~\\_____
    / /  ) )  \\  \\  \\     '=~
   (_/  (_/   (_/ (_/`,
`     /\\___/\\
     (  ◉ ◉)
~,       ´´
(     /   \\
 ◝  / ||| \\
   \\(  m m  )`,
`    /\\___/\\
    (◉ ◉  )
      ´´      _,~
      /   \\  (
     / ||| \\  )
    (  m m  )/`],
      happy: [
`    /\\___/\\
    (  ✦ ✦)_ _ _ _
        ´´  ~~~~~~~\\_____
    / /  ) )  \\  \\  \\     '=~
   (_/  (_/   (_/ (_/`],
      sad: [
`     /\\___/\\
     (  ° ︵°)
          ´´
      /   \\
     / ||| \\
    (  m m  )`],
      alert: [
`     /\\___/\\
    ( ◉  ◉ )_/_/_/_
       ´´    ~~~~~~~\\_____,=~
    / /  / /  \\  \\  \\
   (_/  (_/   (_/ (_/`] },

    /* ── 11: 1+ spontaneous or 30+ min ─────────────────────────── */
    { fontSize: 10, wander: false, caption: 'it has grown wings',
      neutral: [
`    /\\___/\\   _  __
   | ◉ ◉ |  ◜ ◜  ◝          _
    \\ ▽  /  / /   vvvv       ◜  ◝
      ''   _/_/_ _ _        //  (~)
     /                 \\____//
     |                \\_____/
    / / \\ \\   \\  \\  \\
   / /   \\ \\   \\  \\  \\
 (,,/   (,,/  (,,/ (,,/`,
`    /\\___/\\      _  __
    (  ◉ ◉)   ◜ ◜  ◝          _
     \\    ▽   / /   vvvv       ◜  ◝
        ''   _/_/_ _ _        //  (~)
     /                 \\____//
     |                \\_____/
    / / \\ \\   \\  \\  \\
   / /   \\ \\   \\  \\  \\
 (,,/   (,,/  (,,/ (,,/`,
`     _/\\__/\\     _  __
    (◉ ◉  )   ◜ ◜  ◝          _
    ▽     /   / /   vvvv       ◜  ◝
     ''      _/_/_ _ _        //  (~)
     /                 \\____//
     |                \\_____/
    / / \\ \\   \\  \\  \\
   / /   \\ \\   \\  \\  \\
 (,,/   (,,/  (,,/ (,,/`],
      happy: [
`     _/\\__/\\    _   __
    (^  ^  )  /  /  vvv ◝
    ▽     /  /  /   vvvv ◝
     ''   ( _|_ |_ _ _
    /                 \\__       _
    |                \\__ ◝    (_ ◝
    / / \\ \\   \\  \\  \\   \\ \\       )
   / /   \\ \\   \\  \\  \\   \\ \\ _   /
 (,,/   (,,/  (,,/ (,,/    \\ __ _/`],
      sad: [
`    /\\___/\\   _  __
   | ° ︵ °|  ◜ ◜  ◝
    \\ ▽  /  / /
      ''   _/_/_ _ _
     /                 \\____
     |                \\_____/
    / / \\ \\   \\  \\  \\
   / /   \\ \\   \\  \\  \\
 (,,/   (,,/  (,,/ (,,/`],
      alert: [
`     _/\\__/\\    _   __
    (o  o )  /  /  vvv ◝
    ▽     /  /  /   vvvv ◝
     ''   ( _|_ |_ _ _
    /                 \\__       _
    |                \\__ ◝    (_ ◝
    / / \\ \\   \\  \\  \\   \\ \\       )
   / /   \\ \\   \\  \\  \\   \\ \\ _   /
 (,,/   (,,/  (,,/ (,,/    \\ __ _/`] },

    /* ── 12: 3+ spontaneous or 40+ min ─────────────────────────── */
    { fontSize: 8, wander: false, caption: 'a dragon',
      neutral: [
`               ,   ,     _   __
             _/\\__/\\   /  / vvv ◝
            (^  ^  )  /  /  vvvvv ◝
 ~ _ ,      ▽     /  /  /   vvvvvv ◝
( < #}>===   ''   ( _|_ |_ _ _
 ~ ¯ '       /                 \\__        _
             |                \\__ ◝    (_~ ◝
             / / \\ \\   \\  \\  \\   \\ \\        )
            / /   ) )   \\  \\  \\   \\ \\ _    /
           / /   / /     \\  \\  \\   \\ __ _ /
         (,,/  (,,/     (,,/ (,,/`,
`               ,   ,     _   __
             _/\\__/\\   /  / vvv ◝
            (o  o  )  /  /  vvvvv ◝
 ~ _ ,      ▽     /  /  /   vvvvvv ◝
( < #}>===   ''   ( _|_ |_ _ _
 ~ ¯ '       /                 \\__        _
             |                \\__ ◝    (_~ ◝
             / / \\ \\   \\  \\  \\   \\ \\        )
            / /   ) )   \\  \\  \\   \\ \\ _    /
           / /   / /     \\  \\  \\   \\ __ _ /
         (,,/  (,,/     (,,/ (,,/`],
      happy: [
`               ,   ,     _   __
             _/\\__/\\   /  / vvv ◝
            (◉ ◉  )  /  /  vvvvv ◝
 ~ _ ,      ▽     /  /  /   vvvvvv ◝
( < #}>===   ''   ( _|_ |_ _ _
 ~ ¯ '       /                 \\__        _
             |                \\__ ◝    (_~ ◝
             / / \\ \\   \\  \\  \\   \\ \\        )
            / /   ) )   \\  \\  \\   \\ \\ _    /
           / /   / /     \\  \\  \\   \\ __ _ /
         (,,/  (,,/     (,,/ (,,/`],
      alert: [
`               ,   ,     _   __
             _/\\__/\\   /  / vvv ◝
            (✦ ✦  )  /  /  vvvvv ◝
 ~ _ ,      ▽     /  /  /   vvvvvv ◝
( < #}>===   ''   ( _|_ |_ _ _
 ~ ¯ '       /                 \\__        _
             |                \\__ ◝    (_~ ◝
             / / \\ \\   \\  \\  \\   \\ \\        )
            / /   ) )   \\  \\  \\   \\ \\ _    /
           / /   / /     \\  \\  \\   \\ __ _ /
         (,,/  (,,/     (,,/ (,,/`],
      fire: [
`               ,   ,     _   __
             _/\\__/\\   /  / vvv ◝
            (◉ ◉  )  /  /  vvvvv ◝
 ~ _ ,      ▽     /  /  /   vvvvvv ◝
(=={#}>==>   ''   ( _|_ |_ _ _
 ~ ¯ '       /                 \\__        _
             |                \\__ ◝    (_~ ◝
             / / \\ \\   \\  \\  \\   \\ \\        )
            / /   ) )   \\  \\  \\   \\ \\ _    /
           / /   / /     \\  \\  \\   \\ __ _ /
         (,,/  (,,/     (,,/ (,,/`,
`               ,   ,     _   __
             _/\\__/\\   /  / vvv ◝
            (◉ ◉  )  /  /  vvvvv ◝
 ~ _ ,      ▽     /  /  /   vvvvvv ◝
( <=={#}>    ''   ( _|_ |_ _ _
 ~ ¯ '       /                 \\__        _
             |                \\__ ◝    (_~ ◝
             / / \\ \\   \\  \\  \\   \\ \\        )
            / /   ) )   \\  \\  \\   \\ \\ _    /
           / /   / /     \\  \\  \\   \\ __ _ /
         (,,/  (,,/     (,,/ (,,/`],
      sad: [
`               ,   ,     _   __
             _/\\__/\\   /  / vvv ◝
            (°  ° )  /  /  vvvvv ◝
 ~ _ ,      ▽     /  /  /   vvvvvv ◝
( < #}>===   ''   ( _|_ |_ _ _
 ~ ¯ '       /                 \\__        _
             |                \\__ ◝    (_~ ◝
             / / \\ \\   \\  \\  \\   \\ \\        )
            / /   ) )   \\  \\  \\   \\ \\ _    /
           / /   / /     \\  \\  \\   \\ __ _ /
         (,,/  (,,/     (,,/ (,,/`] },

  ]; /* END STAGES — append new stages here without changing anything else */

  /* ═══════════════════════════════════════════════════════════════
     2 · CONSTANTS
     ═══════════════════════════════════════════════════════════════ */
  const MAX_NODES           = 24;
  const NODE_RADIUS         = 13;
  const HIT_RADIUS          = 18;
  const HEBBIAN_RATE        = 0.045;
  const WEIGHT_DECAY        = 0.012;
  const WEIGHT_MAX          = 1.0;
  const PRUNE_FLOOR         = 0.04;
  const CONN_GRACE_TICKS    = 40;
  const SPONTANEOUS_EVERY   = 30;
  const SPONTANEOUS_BASE_P  = 0.05;
  const TICK_MS             = 100;
  const N_OSC_VOICES        = 6;
  const N_LFO_VOICES        = 3;
  const CREATURE_FRAME_INT  = 2.2;   // seconds between sprite frame switches
  const FIRE_DURATION       = 2.2;   // seconds fire animation plays
  const CONSONANT_CENTS     = [0, 200, 400, 500, 700, 900, 1100];
  const CONSONANCE_WIDTH    = 60;
  const TYPE_COLOR = { osc: '#3A4FCC', mod: '#9E2E5E', lfo: '#2A7A6A' };
  const DRAG_THRESH         = 5;

  /* ═══════════════════════════════════════════════════════════════
     3 · DOM REFS
     ═══════════════════════════════════════════════════════════════ */
  const graphCanvas    = document.getElementById('ng-graph');
  const gctx           = graphCanvas.getContext('2d');
  const creatureStage  = document.getElementById('ng-creature-stage');
  const creaturePre    = document.getElementById('ng-creature-pre');
  const creatureCap    = document.getElementById('creature-caption');
  const btnModePlace   = document.getElementById('btn-mode-place');
  const btnModeConnect = document.getElementById('btn-mode-connect');
  const btnModeDisconn = document.getElementById('btn-mode-disconnect');
  const btnModeRemove  = document.getElementById('btn-mode-remove');
  const selType        = document.getElementById('sel-type');
  const selAct         = document.getElementById('sel-act');
  const btnPlay        = document.getElementById('btn-play');
  const btnReset       = document.getElementById('btn-reset');
  const volSlider      = document.getElementById('vol-slider');
  const volVal         = document.getElementById('vol-val');
  const statNodes      = document.getElementById('stat-nodes');
  const statConns      = document.getElementById('stat-conns');
  const statMood       = document.getElementById('stat-mood');
  const statAge        = document.getElementById('stat-age');
  const curriculum     = document.getElementById('curriculum');
  const currToggle     = document.getElementById('curriculum-toggle');

  /* ═══════════════════════════════════════════════════════════════
     4 · STATE
     ═══════════════════════════════════════════════════════════════ */
  let nodes = [], connections = [];
  let nextNodeId = 1, nextConnId = 1;
  let uiMode = 'place';
  let selectedNodeId = null;
  let isPlaying = false;
  let masterVolume = 0.6;
  let mood = 0.6;
  let avgActivation = 0;
  let sessionStartMs = performance.now();
  let totalConnFormed = 0;
  let spontConnFormed = 0;
  let tickCount = 0;
  let fireBreathingUntil = 0;

  /* Creature animation */
  let creatureFrame = 0;
  let creatureFrameAt = 0;
  let lastDisplayedStage = -1;
  let lastDisplayedSprite = '';

  /* Wander state (stages 1-5) */
  const W = {
    x: 20, y: 20,
    tx: 20, ty: 20,
    timer: 0,
    dirLeft: false,
  };

  /* Pointer / drag state */
  const P = { down: false, startPos: null, startNode: null, dragging: false };

  /* ═══════════════════════════════════════════════════════════════
     5 · NODE / CONNECTION FACTORIES
     ═══════════════════════════════════════════════════════════════ */
  function nowSec() { return (performance.now() - sessionStartMs) / 1000; }

  function yToFreq(y, h) {
    return 110 * Math.pow(8, 1 - Math.max(0, Math.min(1, y / h)));
  }

  function makeNode(x, y, type, act) {
    return {
      id: nextNodeId++, x, y, type, act,
      freqBase: type === 'osc' ? yToFreq(y, graphCanvas.height) : null,
      phase:    Math.random() * Math.PI * 2,
      phaseR:   0.15 + Math.random() * 0.5,
      drive:    0.5 + Math.random() * 0.5,
      activation: 0,
    };
  }

  function makeConn(aId, bId, spontaneous) {
    totalConnFormed++;
    return { id: nextConnId++, a: aId, b: bId,
             weight: spontaneous ? 0.12 : 0.22, age: 0, spontaneous: !!spontaneous };
  }

  function findNode(id) { return nodes.find(n => n.id === id); }

  function connExists(aId, bId) {
    return connections.some(c => (c.a === aId && c.b === bId) || (c.a === bId && c.b === aId));
  }

  function applyActivation(x, act) {
    if (act === 'relu')    return x > 0.18 ? Math.min(1, x) : 0;
    if (act === 'sigmoid') return 1 / (1 + Math.exp(-4 * x));
    return Math.tanh(x * 1.6);
  }

  /* ═══════════════════════════════════════════════════════════════
     6 · NETWORK ENGINE  (runs on its own clock, never pauses)
     ═══════════════════════════════════════════════════════════════ */
  function networkTick() {
    tickCount++;

    /* propagate activations */
    for (const n of nodes) {
      n.phase += n.phaseR * (TICK_MS / 1000);
      let incoming = Math.sin(n.phase) * n.drive * 0.6;
      for (const c of connections) {
        const srcId = c.b === n.id ? c.a : (c.a === n.id ? c.b : null);
        if (srcId === null) continue;
        const src = findNode(srcId);
        const w = (c.b === n.id) ? c.weight : c.weight * 0.55;
        if (src) incoming += src.activation * w;
      }
      n.activation = applyActivation(incoming, n.act);
    }

    /* Hebbian weight update + decay */
    for (const c of connections) {
      const a = findNode(c.a), b = findNode(c.b);
      if (!a || !b) continue;
      const coAct = Math.abs(a.activation) * Math.abs(b.activation);
      c.weight += HEBBIAN_RATE * coAct - WEIGHT_DECAY * c.weight;
      c.weight = Math.max(0, Math.min(WEIGHT_MAX, c.weight));
      c.age++;
    }

    /* prune */
    connections = connections.filter(c => !(c.age > CONN_GRACE_TICKS && c.weight < PRUNE_FLOOR));

    /* mood / consonance */
    mood = computeMood();
    avgActivation = nodes.length
      ? nodes.reduce((s, n) => s + Math.abs(n.activation), 0) / nodes.length : 0;

    /* gentle consonance correction */
    consonanceCorrection();

    /* spontaneous connections */
    if (tickCount % SPONTANEOUS_EVERY === 0) trySpontaneous();

    updateStatsUI();
  }

  function computeMood() {
    const active = nodes.filter(n => n.type === 'osc' && Math.abs(n.activation) > 0.2 && n.freqBase);
    if (active.length < 2) return 0.65;
    let total = 0, count = 0;
    for (let i = 0; i < active.length; i++) {
      for (let j = i + 1; j < active.length; j++) {
        const cents = 1200 * Math.log2(active[j].freqBase / active[i].freqBase);
        const mc = ((cents % 1200) + 1200) % 1200;
        let best = Infinity;
        for (const t of CONSONANT_CENTS) best = Math.min(best, Math.abs(mc - t));
        total += Math.max(0, 1 - best / CONSONANCE_WIDTH);
        count++;
      }
    }
    return count ? total / count : 0.65;
  }

  function consonanceCorrection() {
    const active = nodes.filter(n => n.type === 'osc' && Math.abs(n.activation) > 0.2 && n.freqBase);
    if (active.length < 2) return;
    let anchor = active[0];
    for (const n of active) if (Math.abs(n.activation) > Math.abs(anchor.activation)) anchor = n;
    const str = (1 - mood) * 0.004;
    for (const n of active) {
      if (n === anchor) continue;
      const cents = 1200 * Math.log2(n.freqBase / anchor.freqBase);
      const mc = ((cents % 1200) + 1200) % 1200;
      let bestT = CONSONANT_CENTS[0], bestD = Infinity;
      for (const t of CONSONANT_CENTS) { const d = Math.abs(mc - t); if (d < bestD) { bestD = d; bestT = t; } }
      n.freqBase += (anchor.freqBase * Math.pow(2, bestT / 1200) - n.freqBase) * str;
    }
  }

  function trySpontaneous() {
    if (nodes.length < 3 || connections.length >= MAX_NODES * 2) return;
    const cands = [];
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        if (connExists(nodes[i].id, nodes[j].id)) continue;
        const co = Math.abs(nodes[i].activation) * Math.abs(nodes[j].activation);
        if (co > 0.15) cands.push({ a: nodes[i], b: nodes[j], co });
      }
    }
    if (!cands.length) return;
    cands.sort((x, y) => y.co - x.co);
    const prob = SPONTANEOUS_BASE_P + mood * 0.12;
    if (Math.random() < prob) {
      connections.push(makeConn(cands[0].a.id, cands[0].b.id, true));
      spontConnFormed++;
      fireBreathingUntil = nowSec() + FIRE_DURATION;
    }
  }

  /* ═══════════════════════════════════════════════════════════════
     7 · AUDIO ENGINE
     ═══════════════════════════════════════════════════════════════ */
  let audioCtx = null, masterGain = null;
  let oscVoices = [], lfoVoices = [];

  function initAudio() {
    if (audioCtx) return;
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    masterGain = audioCtx.createGain();
    masterGain.gain.value = masterVolume;
    masterGain.connect(audioCtx.destination);
  }

  function audioUpdate() {
    if (!isPlaying || !audioCtx) return;
    const t = audioCtx.currentTime + 0.02;

    /* Oscillator voices */
    const oscCands = nodes
      .filter(n => n.type === 'osc' && Math.abs(n.activation) > 0.12)
      .sort((a, b) => Math.abs(b.activation) - Math.abs(a.activation))
      .slice(0, N_OSC_VOICES);

    const keepIds = new Set(oscCands.map(n => n.id));
    oscVoices = oscVoices.filter(v => {
      if (keepIds.has(v.nodeId)) return true;
      v.gain.gain.setTargetAtTime(0, t, 0.4);
      setTimeout(() => { try { v.osc.stop(); v.osc.disconnect(); v.filter.disconnect(); v.gain.disconnect(); } catch(e){} }, 900);
      return false;
    });
    for (const n of oscCands) {
      if (oscVoices.some(v => v.nodeId === n.id)) continue;
      const osc = audioCtx.createOscillator();
      const filter = audioCtx.createBiquadFilter();
      const gain = audioCtx.createGain();
      osc.type = 'sine'; osc.frequency.value = n.freqBase || 220;
      filter.type = 'lowpass'; filter.frequency.value = 1200; filter.Q.value = 0.6;
      gain.gain.value = 0;
      osc.connect(filter); filter.connect(gain); gain.connect(masterGain); osc.start();
      oscVoices.push({ nodeId: n.id, osc, filter, gain });
    }
    for (const v of oscVoices) {
      const n = findNode(v.nodeId); if (!n) continue;
      v.osc.frequency.setTargetAtTime(n.freqBase || 220, t, 0.08);
      v.gain.gain.setTargetAtTime(Math.max(0, Math.min(1, Math.abs(n.activation))) * 0.22, t, 0.06);
      let timbre = 0;
      for (const c of connections) {
        const oid = c.a === n.id ? c.b : (c.b === n.id ? c.a : null);
        if (oid === null) continue;
        const o = findNode(oid);
        if (o && o.type === 'mod') timbre += Math.abs(o.activation) * c.weight;
      }
      v.filter.frequency.setTargetAtTime(260 * Math.pow(28, Math.max(0, Math.min(1, timbre))), t, 0.1);
    }

    /* LFO voices */
    const lfoCands = nodes
      .filter(n => n.type === 'lfo' && Math.abs(n.activation) > 0.12)
      .sort((a, b) => Math.abs(b.activation) - Math.abs(a.activation))
      .slice(0, N_LFO_VOICES);

    const keepLfo = new Set(lfoCands.map(n => n.id));
    lfoVoices = lfoVoices.filter(v => {
      if (keepLfo.has(v.nodeId)) return true;
      try { v.gain.gain.value = 0; v.osc.stop(); v.osc.disconnect(); v.gain.disconnect(); } catch(e){}
      return false;
    });
    for (const n of lfoCands) {
      if (lfoVoices.some(v => v.nodeId === n.id)) continue;
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine'; osc.frequency.value = 1.5; gain.gain.value = 0;
      osc.connect(gain); osc.start();
      lfoVoices.push({ nodeId: n.id, osc, gain });
    }
    for (const v of lfoVoices) {
      const n = findNode(v.nodeId); if (!n) continue;
      v.osc.frequency.setTargetAtTime(0.3 + Math.abs(n.activation) * 5.5, t, 0.2);
      try { v.gain.disconnect(); } catch(e){}
      let depth = 0;
      for (const c of connections) {
        const oid = c.a === n.id ? c.b : (c.b === n.id ? c.a : null);
        if (oid === null) continue;
        const tv = oscVoices.find(ov => ov.nodeId === oid);
        if (tv) { v.gain.connect(tv.osc.frequency); depth = Math.max(depth, c.weight); }
      }
      v.gain.gain.setTargetAtTime(depth * Math.abs(n.activation) * 14, t, 0.15);
    }
  }

  function stopAllAudio() {
    for (const v of oscVoices) { try { v.gain.gain.value = 0; v.osc.stop(); } catch(e){} }
    for (const v of lfoVoices) { try { v.gain.gain.value = 0; v.osc.stop(); } catch(e){} }
    oscVoices = []; lfoVoices = [];
  }

  /* ═══════════════════════════════════════════════════════════════
     8 · CREATURE ENGINE
     ═══════════════════════════════════════════════════════════════ */
  function milestoneLevel() {
    const nc  = nodes.length;
    const cc  = connections.length;
    const sc  = spontConnFormed;
    const min = nowSec() / 60;
    if (sc >= 3 || min >= 40)  return Math.min(12, STAGES.length - 1);
    if (sc >= 1 || min >= 30)  return Math.min(11, STAGES.length - 1);
    if (cc >= 22 || min >= 23) return Math.min(10, STAGES.length - 1);
    if (cc >= 18 || min >= 16) return Math.min(9,  STAGES.length - 1);
    if (cc >= 14 || min >= 10) return Math.min(8,  STAGES.length - 1);
    if (cc >= 11 || min >= 6)  return Math.min(7,  STAGES.length - 1);
    if (cc >= 8  || min >= 3)  return Math.min(6,  STAGES.length - 1);
    if (cc >= 5)               return 5;
    if (cc >= 3)               return 4;
    if (cc >= 1)               return 3;
    if (nc >= 2)               return 2;
    if (nc >= 1)               return 1;
    return 0;
  }

  function getMoodKey(sd) {
    const now = nowSec();
    if (now < fireBreathingUntil && sd.fire) return 'fire';
    if (avgActivation > 0.7 && sd.alert)     return 'alert';
    if (mood > 0.7  && sd.happy)             return 'happy';
    if (mood < 0.38 && sd.sad)               return 'sad';
    return 'neutral';
  }

  function centerCreature() {
    const sw = creatureStage.offsetWidth;
    const sh = creatureStage.offsetHeight;
    const pw = creaturePre.scrollWidth;
    const ph = creaturePre.scrollHeight;
    creaturePre.style.left = Math.max(6, (sw - pw) / 2) + 'px';
    creaturePre.style.top  = Math.max(6, (sh - ph) / 2) + 'px';
  }

  function updateWander(sd, dt) {
    const sw = creatureStage.offsetWidth;
    const sh = creatureStage.offsetHeight;
    const pw = creaturePre.scrollWidth  || 30;
    const ph = creaturePre.scrollHeight || 20;
    /* decrement using real elapsed time so wander speed is frame-rate independent */
    W.timer -= (dt || 0.016);
    if (W.timer <= 0) {
      const mx  = Math.max(6, sw - pw - 12);
      const my  = Math.max(6, sh - ph - 12);
      const nx  = 6 + Math.random() * mx;
      const ny  = 6 + Math.random() * my;
      W.dirLeft = nx < W.tx;
      W.tx = nx; W.ty = ny;
      /* speed 42-80 → interval ~2-4 s (faster stages get shorter intervals) */
      W.timer = 1.6 + Math.random() * Math.max(0.5, (100 - sd.speed) / 20);
    }
    creaturePre.style.left = W.tx + 'px';
    creaturePre.style.top  = W.ty + 'px';
  }

  function renderCreature(dt) {
    const stage = milestoneLevel();
    const sd    = STAGES[stage];
    if (!sd) return;

    /* advance animation frame on a real-time clock */
    const now = nowSec();
    if (now - creatureFrameAt > CREATURE_FRAME_INT) {
      creatureFrame++;
      creatureFrameAt = now;
    }

    /* select sprite array — wander stages use directional keys, others use mood */
    let frames;
    if (sd.wander) {
      /* pick direction-aware sprite; fall back through still → neutral → dot */
      frames = (W.dirLeft ? sd.left : sd.right) || sd.still || sd.neutral || ['·'];
    } else {
      const key = getMoodKey(sd);
      frames = sd[key] || sd.neutral || ['·'];
    }
    /* guard against empty / undefined arrays */
    if (!frames || !frames.length) frames = ['·'];

    const sprite  = frames[creatureFrame % frames.length];
    const changed = sprite !== lastDisplayedSprite || stage !== lastDisplayedStage;

    if (changed) {
      creaturePre.style.fontSize = sd.fontSize + 'px';
      creaturePre.textContent    = sprite;
      lastDisplayedStage         = stage;
      lastDisplayedSprite        = sprite;
    }

    if (sd.wander) {
      creaturePre.style.transition = 'left 1.1s ease-in-out, top 1.1s ease-in-out';
      updateWander(sd, dt);
    } else {
      creaturePre.style.transition = '';
      /* re-centre whenever content changes or on first render of this stage */
      if (changed) requestAnimationFrame(centerCreature);
    }

    creatureCap.textContent = sd.caption;
  }

  /* ═══════════════════════════════════════════════════════════════
     9 · ACTIVATION FUNCTION GRAPHS
     ═══════════════════════════════════════════════════════════════ */
  const BG   = '#F1C6D3';
  const INK  = '#20269D';

  function drawActFnCanvas(canvasId, fn, xMin, xMax, yMin, yMax) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const ctx  = canvas.getContext('2d');
    const W    = canvas.width, H = canvas.height;
    const pad  = 28;
    const cw   = W - pad * 2, ch = H - pad * 2;

    function cx(x) { return pad + ((x - xMin) / (xMax - xMin)) * cw; }
    function cy(y) { return pad + ((yMax - y) / (yMax - yMin)) * ch; }

    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, W, H);

    /* grid lines */
    ctx.strokeStyle = INK; ctx.globalAlpha = 0.12; ctx.lineWidth = 1;
    for (let gx = Math.ceil(xMin); gx <= Math.floor(xMax); gx++) {
      ctx.beginPath(); ctx.moveTo(cx(gx), pad); ctx.lineTo(cx(gx), pad + ch); ctx.stroke();
    }
    for (let gy = Math.ceil(yMin); gy <= Math.floor(yMax); gy++) {
      ctx.beginPath(); ctx.moveTo(pad, cy(gy)); ctx.lineTo(pad + cw, cy(gy)); ctx.stroke();
    }

    /* axes */
    ctx.globalAlpha = 0.35; ctx.lineWidth = 1;
    if (xMin <= 0 && xMax >= 0) { ctx.beginPath(); ctx.moveTo(cx(0), pad); ctx.lineTo(cx(0), pad + ch); ctx.stroke(); }
    if (yMin <= 0 && yMax >= 0) { ctx.beginPath(); ctx.moveTo(pad, cy(0)); ctx.lineTo(pad + cw, cy(0)); ctx.stroke(); }

    /* axis labels */
    ctx.globalAlpha = 0.55; ctx.fillStyle = INK;
    ctx.font = '9px Inter, sans-serif'; ctx.textAlign = 'center';
    for (let gx = Math.ceil(xMin); gx <= Math.floor(xMax); gx++) {
      if (gx === 0) continue;
      ctx.fillText(gx, cx(gx), H - 4);
    }
    ctx.textAlign = 'right';
    for (let gy = Math.ceil(yMin); gy <= Math.floor(yMax); gy++) {
      ctx.fillText(gy === 0 ? '0' : gy, pad - 3, cy(gy) + 3);
    }

    /* curve */
    ctx.globalAlpha = 1; ctx.strokeStyle = INK; ctx.lineWidth = 2;
    ctx.beginPath();
    const steps = cw * 2;
    for (let i = 0; i <= steps; i++) {
      const x = xMin + (i / steps) * (xMax - xMin);
      const y = Math.max(yMin, Math.min(yMax, fn(x)));
      if (i === 0) ctx.moveTo(cx(x), cy(y)); else ctx.lineTo(cx(x), cy(y));
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  function initActFnGraphs() {
    const reluSlider   = document.getElementById('slider-relu');
    const sigSlider    = document.getElementById('slider-sigmoid');
    const tanhSlider   = document.getElementById('slider-tanh');
    const reluVal      = document.getElementById('val-relu');
    const sigVal       = document.getElementById('val-sigmoid');
    const tanhVal      = document.getElementById('val-tanh');

    if (!reluSlider) return;

    function drawRelu(thresh) {
      drawActFnCanvas('canvas-relu', x => x > thresh ? x - thresh : 0, -2, 2, -0.2, 2);
    }
    function drawSig(k) {
      drawActFnCanvas('canvas-sigmoid', x => 1 / (1 + Math.exp(-k * x)), -3, 3, -0.1, 1.1);
    }
    function drawTanh(scale) {
      drawActFnCanvas('canvas-tanh', x => Math.tanh(scale * x), -3, 3, -1.2, 1.2);
    }

    drawRelu(parseFloat(reluSlider.value));
    drawSig(parseFloat(sigSlider.value));
    drawTanh(parseFloat(tanhSlider.value));

    reluSlider.addEventListener('input', () => {
      const v = parseFloat(reluSlider.value);
      reluVal.textContent = v.toFixed(2);
      drawRelu(v);
    });
    sigSlider.addEventListener('input', () => {
      const v = parseFloat(sigSlider.value);
      sigVal.textContent = v.toFixed(1);
      drawSig(v);
    });
    tanhSlider.addEventListener('input', () => {
      const v = parseFloat(tanhSlider.value);
      tanhVal.textContent = v.toFixed(1);
      drawTanh(v);
    });
  }

  /* ═══════════════════════════════════════════════════════════════
     10 · TICK SCHEDULING  (never pauses — audio clock driven)
     ═══════════════════════════════════════════════════════════════ */
  let lastTickWall = performance.now();

  function scheduleTick() {
    setTimeout(() => {
      const now     = performance.now();
      const elapsed = now - lastTickWall;
      lastTickWall  = now;
      const owed    = Math.min(50, Math.max(1, Math.round(elapsed / TICK_MS)));
      for (let i = 0; i < owed; i++) networkTick();
      audioUpdate();
      scheduleTick();
    }, TICK_MS);
  }

  /* ═══════════════════════════════════════════════════════════════
     11 · RENDER LOOP  (visual only — rAF, idles when backgrounded)
     ═══════════════════════════════════════════════════════════════ */
  function drawGraph() {
    const W = graphCanvas.width, H = graphCanvas.height;
    gctx.fillStyle = BG;
    gctx.fillRect(0, 0, W, H);

    /* connections */
    for (const c of connections) {
      const a = findNode(c.a), b = findNode(c.b); if (!a || !b) continue;
      /* spontaneous connections are drawn slightly warmer to distinguish them */
      gctx.strokeStyle = c.spontaneous ? '#9E2E5E' : '#6066C2';
      gctx.globalAlpha = 0.12 + c.weight * 0.7;
      gctx.lineWidth   = 0.6 + c.weight * 4.5;
      gctx.beginPath(); gctx.moveTo(a.x, a.y); gctx.lineTo(b.x, b.y); gctx.stroke();
    }
    gctx.globalAlpha = 1;

    /* nodes */
    const TYPE_LABEL = { osc: 'O', mod: 'T', lfo: 'L' };
    for (const n of nodes) {
      const pulse = Math.abs(n.activation) * 5;
      const r     = NODE_RADIUS + pulse;

      /* fill */
      gctx.fillStyle   = TYPE_COLOR[n.type];
      gctx.globalAlpha = 0.88 + Math.abs(n.activation) * 0.12;
      gctx.beginPath(); gctx.arc(n.x, n.y, r, 0, Math.PI * 2); gctx.fill();

      /* selection ring — shown for any mode that uses two-click selection */
      if (n.id === selectedNodeId) {
        gctx.globalAlpha = 1;
        gctx.strokeStyle = INK; gctx.lineWidth = 2.5;
        gctx.setLineDash([4, 3]);
        gctx.beginPath(); gctx.arc(n.x, n.y, r + 6, 0, Math.PI * 2); gctx.stroke();
        gctx.setLineDash([]);
      }

      /* type label */
      gctx.globalAlpha = 0.85;
      gctx.fillStyle   = '#fff';
      gctx.font        = `bold ${Math.round(r * 0.75)}px Inter, sans-serif`;
      gctx.textAlign   = 'center';
      gctx.textBaseline = 'middle';
      gctx.fillText(TYPE_LABEL[n.type] || '?', n.x, n.y);
    }
    gctx.globalAlpha  = 1;
    gctx.textAlign    = 'left';
    gctx.textBaseline = 'alphabetic';

    /* mode hint: show "click a second node" prompt when one is selected */
    if (selectedNodeId !== null) {
      const sel = findNode(selectedNodeId);
      if (sel) {
        const hint = uiMode === 'connect' ? 'click second node to connect'
                   : uiMode === 'disconnect' ? 'click second node to disconnect' : '';
        if (hint) {
          gctx.font = '11px Inter, sans-serif';
          gctx.fillStyle = INK;
          gctx.globalAlpha = 0.55;
          gctx.fillText(hint, 8, H - 8);
          gctx.globalAlpha = 1;
        }
      }
    }
  }

  let lastRenderMs = performance.now();
  function render() {
    const now = performance.now();
    const dt  = Math.min(0.1, (now - lastRenderMs) / 1000); // cap at 100ms for tab-switch recovery
    lastRenderMs = now;
    drawGraph();
    renderCreature(dt);
    requestAnimationFrame(render);
  }

  /* ═══════════════════════════════════════════════════════════════
     12 · STATS UI
     ═══════════════════════════════════════════════════════════════ */
  const MOOD_LABELS = [[0.28, 'restless'], [0.48, 'searching'], [0.68, 'settled'], [1.01, 'warm']];
  function moodLabel(m) {
    for (const [t, l] of MOOD_LABELS) if (m < t) return l;
    return 'warm';
  }

  function updateStatsUI() {
    statNodes.textContent = nodes.length;
    statConns.textContent = connections.length;
    statMood.textContent  = moodLabel(mood);
    const s = Math.floor(nowSec());
    statAge.textContent   = Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
    btnModePlace.disabled = nodes.length >= MAX_NODES;
  }

  /* ═══════════════════════════════════════════════════════════════
     13 · POINTER EVENTS  (graph canvas — drag to move + mode clicks)
     ═══════════════════════════════════════════════════════════════ */
  function canvasPos(e) {
    const r = graphCanvas.getBoundingClientRect();
    const s = e.touches ? e.touches[0] : e;
    return {
      x: (s.clientX - r.left) * (graphCanvas.width  / r.width),
      y: (s.clientY - r.top)  * (graphCanvas.height / r.height),
    };
  }

  function nodeAt(x, y) {
    let best = null, bd = HIT_RADIUS;
    for (const n of nodes) {
      const d = Math.hypot(n.x - x, n.y - y);
      if (d < bd) { bd = d; best = n; }
    }
    return best;
  }

  function handleClick(pos, hit) {
    if (uiMode === 'place') {
      if (hit || nodes.length >= MAX_NODES) return;
      /* start the session clock on the very first node so reading time doesn't
         count toward time-based milestones */
      if (nodes.length === 0) sessionStartMs = performance.now();
      nodes.push(makeNode(pos.x, pos.y, selType.value, selAct.value));
      updateStatsUI();
    } else if (uiMode === 'connect') {
      if (!hit) { selectedNodeId = null; return; }
      if (selectedNodeId === null) { selectedNodeId = hit.id; return; }
      if (selectedNodeId === hit.id) { selectedNodeId = null; return; }
      if (!connExists(selectedNodeId, hit.id)) {
        connections.push(makeConn(selectedNodeId, hit.id, false));
      }
      selectedNodeId = null; updateStatsUI();
    } else if (uiMode === 'disconnect') {
      if (!hit) { selectedNodeId = null; return; }
      if (selectedNodeId === null) { selectedNodeId = hit.id; return; }
      if (selectedNodeId === hit.id) { selectedNodeId = null; return; }
      connections = connections.filter(c =>
        !((c.a === selectedNodeId && c.b === hit.id) || (c.a === hit.id && c.b === selectedNodeId)));
      selectedNodeId = null; updateStatsUI();
    } else if (uiMode === 'remove') {
      if (!hit) return;
      nodes       = nodes.filter(n => n.id !== hit.id);
      connections = connections.filter(c => c.a !== hit.id && c.b !== hit.id);
      updateStatsUI();
    }
  }

  function onPointerDown(e) {
    e.preventDefault();
    const pos = canvasPos(e);
    P.down = true; P.startPos = pos; P.startNode = nodeAt(pos.x, pos.y); P.dragging = false;
  }
  function onPointerMove(e) {
    e.preventDefault();
    const pos   = canvasPos(e);
    const hover = nodeAt(pos.x, pos.y);

    if (!P.down) {
      /* hovering — update cursor so grab hint shows over nodes */
      graphCanvas.style.cursor = hover ? 'grab' : 'crosshair';
      return;
    }
    if (!P.startNode) return;

    const dist = Math.hypot(pos.x - P.startPos.x, pos.y - P.startPos.y);
    if (dist > DRAG_THRESH) {
      P.dragging = true;
      P.startNode.x = pos.x; P.startNode.y = pos.y;
      if (P.startNode.type === 'osc')
        P.startNode.freqBase = yToFreq(pos.y, graphCanvas.height);
    }
    graphCanvas.style.cursor = P.dragging ? 'grabbing' : (hover ? 'grab' : 'crosshair');
  }
  function onPointerUp(e) {
    e.preventDefault();
    if (P.down && !P.dragging) handleClick(P.startPos, P.startNode);
    P.down = false; P.startPos = null; P.startNode = null; P.dragging = false;
    graphCanvas.style.cursor = 'crosshair';
  }

  graphCanvas.addEventListener('mousedown',  onPointerDown);
  graphCanvas.addEventListener('mousemove',  onPointerMove);
  graphCanvas.addEventListener('mouseup',    onPointerUp);
  graphCanvas.addEventListener('mouseleave', onPointerUp);
  graphCanvas.addEventListener('touchstart', onPointerDown, { passive: false });
  graphCanvas.addEventListener('touchmove',  onPointerMove, { passive: false });
  graphCanvas.addEventListener('touchend',   onPointerUp,   { passive: false });

  /* ═══════════════════════════════════════════════════════════════
     14 · UI WIRING
     ═══════════════════════════════════════════════════════════════ */
  function setMode(m) {
    uiMode = m; selectedNodeId = null;
    btnModePlace.classList.toggle('active',   m === 'place');
    btnModeConnect.classList.toggle('active', m === 'connect');
    btnModeDisconn.classList.toggle('active', m === 'disconnect');
    btnModeRemove.classList.toggle('active',  m === 'remove');
  }
  btnModePlace.addEventListener('click',   () => setMode('place'));
  btnModeConnect.addEventListener('click', () => setMode('connect'));
  btnModeDisconn.addEventListener('click', () => setMode('disconnect'));
  btnModeRemove.addEventListener('click',  () => setMode('remove'));

  btnPlay.addEventListener('click', () => {
    if (isPlaying) {
      isPlaying = false;
      btnPlay.textContent = 'play'; btnPlay.classList.remove('active');
      stopAllAudio();
      setTimeout(() => { if (!isPlaying && audioCtx) audioCtx.suspend(); }, 300);
    } else {
      initAudio();
      if (audioCtx.state === 'suspended') audioCtx.resume();
      isPlaying = true;
      btnPlay.textContent = 'stop'; btnPlay.classList.add('active');
    }
  });

  btnReset.addEventListener('click', () => {
    stopAllAudio();
    nodes = []; connections = [];
    selectedNodeId = null; tickCount = 0;
    sessionStartMs = performance.now();
    totalConnFormed = 0; spontConnFormed = 0; fireBreathingUntil = 0;
    creatureFrame = 0; lastDisplayedStage = -1; lastDisplayedSprite = '';
    W.x = 20; W.y = 20; W.tx = 20; W.ty = 20; W.timer = 0;
    updateStatsUI();
  });

  volSlider.addEventListener('input', () => {
    masterVolume = parseInt(volSlider.value, 10) / 100;
    volVal.textContent = volSlider.value + '%';
    if (masterGain && audioCtx) masterGain.gain.setTargetAtTime(masterVolume, audioCtx.currentTime, 0.05);
  });

  currToggle.addEventListener('click', () => curriculum.classList.toggle('open'));

  /* ═══════════════════════════════════════════════════════════════
     15 · CANVAS SIZING
     ═══════════════════════════════════════════════════════════════ */
  function resizeGraph() {
    const wrap = graphCanvas.parentElement;
    graphCanvas.width  = wrap.clientWidth;
    graphCanvas.height = graphCanvas.clientHeight;
  }
  window.addEventListener('resize', () => { resizeGraph(); requestAnimationFrame(centerCreature); });
  resizeGraph();

  /* ═══════════════════════════════════════════════════════════════
     16 · BOOT
     ═══════════════════════════════════════════════════════════════ */
  updateStatsUI();
  initActFnGraphs();
  scheduleTick();
  requestAnimationFrame(render);

})();
