// ========================================
// SPATIAL SOUND TRACKING - THE AUDITORY SHELL GAME
// Trains spatial attention and object persistence
// ========================================

// ========================================
// TONE SOURCE CLASS
// Synthesizes spatial audio with distinct timbres and rhythms
// ========================================

class ToneSource {
  constructor(audioCtx, resonanceScene, config) {
    this.audioCtx = audioCtx;
    this.resonanceScene = resonanceScene;
    
    this.note = config.note;           // E4, G4, C5
    this.frequency = this.noteToFreq(config.note);
    this.timbre = config.timbre;       // 'pluck', 'hum', 'chirp'
    this.rhythm = config.rhythm;       // Interval in ms
    this.color = config.color;         // Visual representation
    this.isTarget = config.isTarget;
    
    this.position = { x: 0, y: 0, z: -1 };
    this.resonanceSource = null;
    this.intervalId = null;
    this.gainNode = null;
  }

  noteToFreq(note) {
    const notes = {
      'E4': 329.63,
      'G4': 392.00,
      'C5': 523.25
    };
    return notes[note] || 440;
  }

  init() {
    // Create Resonance Audio source
    this.resonanceSource = this.resonanceScene.createSource();
    this.resonanceSource.setPosition(this.position.x, this.position.y, this.position.z);
  }

  playNote() {
    const now = this.audioCtx.currentTime;
    
    // Create oscillator based on timbre
    const osc = this.audioCtx.createOscillator();
    const gain = this.audioCtx.createGain();
    
    switch (this.timbre) {
      case 'pluck':
        // Sine wave with fast decay (percussive)
        osc.type = 'sine';
        gain.gain.setValueAtTime(0.3, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
        break;
      
      case 'hum':
        // Triangle wave with slow attack (sustained)
        osc.type = 'triangle';
        gain.gain.setValueAtTime(0.0, now);
        gain.gain.linearRampToValueAtTime(0.2, now + 0.05);
        gain.gain.linearRampToValueAtTime(0.15, now + 0.3);
        break;
      
      case 'chirp':
        // Square wave with filter (bright)
        osc.type = 'square';
        const filter = this.audioCtx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = 1200;
        osc.connect(filter);
        filter.connect(gain);
        
        gain.gain.setValueAtTime(0.15, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
        
        osc.frequency.setValueAtTime(this.frequency, now);
        osc.start(now);
        osc.stop(now + 0.2);
        gain.connect(this.resonanceSource.input);
        return;
    }
    
    osc.frequency.setValueAtTime(this.frequency, now);
    osc.connect(gain);
    gain.connect(this.resonanceSource.input);
    
    osc.start(now);
    osc.stop(now + 0.3);
  }

  startRhythm() {
    this.playNote();
    this.intervalId = setInterval(() => {
      this.playNote();
    }, this.rhythm);
  }

  stopRhythm() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  updatePosition(x, y, z) {
    this.position = { x, y, z };
    if (this.resonanceSource) {
      this.resonanceSource.setPosition(x, y, z);
    }
  }
}

// ========================================
// PATH GENERATOR CLASS
// Generates smooth movement paths with varying complexity
// ========================================

class PathGenerator {
  constructor() {
    this.diagramRadius = 150; // Half of 300px diagram
  }

  // Convert polar to cartesian (for circular diagram)
  polarToCartesian(azimuth, distance) {
    const rad = (azimuth - 90) * Math.PI / 180;
    const x = distance * Math.cos(rad);
    const y = distance * Math.sin(rad);
    return { x, y };
  }

  // Convert cartesian to 3D spatial coords for Resonance Audio
  cartesianToSpatial(x, y) {
    // Normalize to -1 to 1 range
    const normX = x / this.diagramRadius;
    const normY = y / this.diagramRadius;
    
    // Map to 3D space (azimuth around listener)
    return {
      x: normX * 2,
      y: 0,
      z: -normY * 2
    };
  }

  generatePath(complexity, duration, startAngle) {
    const fps = 60;
    const frames = Math.floor(duration * fps);
    const path = [];
    
    switch (complexity) {
      case 'simple':
        return this.generateCircularPath(frames, startAngle);
      case 'medium':
        return this.generateLissajousPath(frames, startAngle);
      case 'complex':
        return this.generateRandomWalkPath(frames, startAngle);
      default:
        return this.generateCircularPath(frames, startAngle);
    }
  }

  generateCircularPath(frames, startAngle) {
    const path = [];
    const angularSpeed = 180 / frames; // 180 degrees over duration
    
    for (let i = 0; i <= frames; i++) {
      const angle = startAngle + (angularSpeed * i);
      const distance = this.diagramRadius * 0.7; // 70% of radius
      
      const { x, y } = this.polarToCartesian(angle, distance);
      const spatial = this.cartesianToSpatial(x, y);
      
      path.push({
        x, y,
        spatialX: spatial.x,
        spatialY: spatial.y,
        spatialZ: spatial.z,
        timestamp: i / 60
      });
    }
    
    return path;
  }

  generateLissajousPath(frames, startAngle) {
    const path = [];
    const offset = startAngle * Math.PI / 180;
    
    for (let i = 0; i <= frames; i++) {
      const t = (i / frames) * Math.PI * 2;
      
      // Lissajous curve: x = A*sin(at + δ), y = B*sin(bt)
      const x = this.diagramRadius * 0.6 * Math.sin(3 * t + offset);
      const y = this.diagramRadius * 0.6 * Math.sin(2 * t);
      
      const spatial = this.cartesianToSpatial(x, y);
      
      path.push({
        x, y,
        spatialX: spatial.x,
        spatialY: spatial.y,
        spatialZ: spatial.z,
        timestamp: i / 60
      });
    }
    
    return path;
  }

  generateRandomWalkPath(frames, startAngle) {
    const path = [];
    
    // Start position
    let angle = startAngle;
    let distance = this.diagramRadius * 0.5;
    
    for (let i = 0; i <= frames; i++) {
      // Smooth random walk using Perlin-like interpolation
      const noiseScale = 0.05;
      angle += (Math.random() - 0.5) * 30; // Random angular change
      distance += (Math.random() - 0.5) * 20;
      
      // Constrain to diagram bounds
      distance = Math.max(20, Math.min(this.diagramRadius * 0.8, distance));
      
      const { x, y } = this.polarToCartesian(angle, distance);
      const spatial = this.cartesianToSpatial(x, y);
      
      path.push({
        x, y,
        spatialX: spatial.x,
        spatialY: spatial.y,
        spatialZ: spatial.z,
        timestamp: i / 60
      });
    }
    
    // Smooth the path
    return this.smoothPath(path);
  }

  smoothPath(path) {
    // Apply simple moving average
    const smoothed = [];
    const window = 3;
    
    for (let i = 0; i < path.length; i++) {
      const start = Math.max(0, i - window);
      const end = Math.min(path.length, i + window + 1);
      
      let sumX = 0, sumY = 0, sumSX = 0, sumSY = 0, sumSZ = 0;
      let count = end - start;
      
      for (let j = start; j < end; j++) {
        sumX += path[j].x;
        sumY += path[j].y;
        sumSX += path[j].spatialX;
        sumSY += path[j].spatialY;
        sumSZ += path[j].spatialZ;
      }
      
      smoothed.push({
        x: sumX / count,
        y: sumY / count,
        spatialX: sumSX / count,
        spatialY: sumSY / count,
        spatialZ: sumSZ / count,
        timestamp: path[i].timestamp
      });
    }
    
    return smoothed;
  }
}

// ========================================
// SPATIAL GAME CLASS
// Main game controller with 5-phase state machine
// ========================================

class SpatialGame {
  constructor() {
    this.audioCtx = null;
    this.resonanceScene = null;
    this.pathGenerator = new PathGenerator();
    
    this.sources = [];
    this.targetSource = null;
    this.paths = [];
    
    this.state = {
      phase: 'idle', // idle, identity, handoff, tracking, reveal, guess
      trials: 0,
      correct: 0,
      
      // Settings
      difficulty: 'easy',
      numSources: 2,
      complexity: 'simple',
      movementSpeed: 1.0,
      
      // Difficulty presets
      presets: {
        easy:   { sources: 2, complexity: 'simple', speed: 1.0 },
        medium: { sources: 2, complexity: 'medium', speed: 1.5 },
        hard:   { sources: 3, complexity: 'complex', speed: 1.5 }
      }
    };
    
    this.animationFrameId = null;
    this.phaseStartTime = null;
  }

  async init() {
    // Initialize audio context and Resonance Audio
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    this.audioCtx = new AudioContext();
    
    this.resonanceScene = new ResonanceAudio(this.audioCtx);
    this.resonanceScene.setRoomProperties({
      width: 8,
      height: 3,
      depth: 8
    }, {
      left: 'acoustic-ceiling-tiles',
      right: 'acoustic-ceiling-tiles',
      front: 'acoustic-ceiling-tiles',
      back: 'acoustic-ceiling-tiles',
      down: 'acoustic-ceiling-tiles',
      up: 'acoustic-ceiling-tiles'
    });
    
    this.resonanceScene.output.connect(this.audioCtx.destination);
    
    console.log('✓ Spatial Game initialized');
  }

  createSources() {
    // Clear existing sources
    this.sources.forEach(src => src.stopRhythm());
    this.sources = [];
    
    const configs = [
      { 
        note: 'E4', 
        timbre: 'pluck', 
        rhythm: 667, // Quarter notes at 90 BPM
        color: '#20269D',
        isTarget: true
      },
      { 
        note: 'G4', 
        timbre: 'hum', 
        rhythm: 222, // Triplet eighths
        color: '#20269D',
        isTarget: false
      },
      { 
        note: 'C5', 
        timbre: 'chirp', 
        rhythm: 500, // Syncopated (adjusted for off-beat feel)
        color: '#20269D',
        isTarget: false
      }
    ];
    
    // Use only the number of sources specified
    for (let i = 0; i < this.state.numSources; i++) {
      const source = new ToneSource(this.audioCtx, this.resonanceScene, configs[i]);
      source.init();
      this.sources.push(source);
      
      if (configs[i].isTarget) {
        this.targetSource = source;
      }
    }
  }

  generatePaths() {
    this.paths = [];
    const duration = 5.0 / this.state.movementSpeed; // Adjusted by speed
    
    // Random starting angles to prevent predictability
    const angles = [];
    for (let i = 0; i < this.state.numSources; i++) {
      angles.push(Math.random() * 360);
    }
    
    for (let i = 0; i < this.sources.length; i++) {
      const path = this.pathGenerator.generatePath(
        this.state.complexity,
        duration,
        angles[i]
      );
      this.paths.push(path);
    }
  }

  drawDots(phase) {
    const diagram = document.getElementById('spatial-diagram');
    
    // Clear existing dots
    const oldDots = diagram.querySelectorAll('.sound-source');
    oldDots.forEach(dot => dot.remove());
    
    this.sources.forEach((source, index) => {
      const dot = document.createElement('div');
      dot.className = 'sound-source';
      dot.dataset.index = index;
      
      // Visual styling based on phase
      if (phase === 'identity' || phase === 'handoff') {
        if (source.isTarget) {
          dot.classList.add('source-target');
        } else {
          dot.classList.add('source-distractor');
        }
      } else if (phase === 'reveal') {
        // All look the same - user must guess
        dot.classList.add('source-distractor');
        dot.classList.add('source-clickable');
        
        // Add click handler
        dot.addEventListener('click', () => this.handleGuess(index));
      }
      
      diagram.appendChild(dot);
    });
  }

  updateDotPositions() {
    const diagram = document.getElementById('spatial-diagram');
    const dots = diagram.querySelectorAll('.sound-source');
    
    this.sources.forEach((source, index) => {
      const dot = dots[index];
      if (dot) {
        const path = this.paths[index];
        const currentFrame = Math.min(
          path.length - 1,
          Math.floor((Date.now() - this.phaseStartTime) / (1000 / 60))
        );
        
        const pos = path[currentFrame];
        
        // Update visual position (centered in 300px diagram)
        dot.style.left = `${150 + pos.x}px`;
        dot.style.top = `${150 + pos.y}px`;
        
        // Update audio position
        source.updatePosition(pos.spatialX, pos.spatialY, pos.spatialZ);
      }
    });
  }

  fadeDots(duration, targetOpacity) {
    const dots = document.querySelectorAll('.sound-source');
    const startTime = Date.now();
    const startOpacity = dots[0] ? parseFloat(window.getComputedStyle(dots[0]).opacity) : 1;
    
    const fade = () => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const opacity = startOpacity + (targetOpacity - startOpacity) * progress;
      
      dots.forEach(dot => {
        dot.style.opacity = opacity;
      });
      
      if (progress < 1) {
        requestAnimationFrame(fade);
      }
    };
    
    fade();
  }

  updatePhaseIndicator(text) {
    document.getElementById('phase-indicator').textContent = text;
  }

  // ========================================
  // PHASE 1: IDENTITY (0-3s)
  // Target plays solo, then all sources join
  // ========================================
  async phaseIdentity() {
    this.state.phase = 'identity';
    this.updatePhaseIndicator('listen — solid dot is the target');
    
    this.drawDots('identity');
    this.phaseStartTime = Date.now();
    
    // Set initial positions
    this.sources.forEach((source, index) => {
      const pos = this.paths[index][0];
      source.updatePosition(pos.spatialX, pos.spatialY, pos.spatialZ);
      
      const diagram = document.getElementById('spatial-diagram');
      const dot = diagram.querySelector(`.sound-source[data-index="${index}"]`);
      if (dot) {
        dot.style.left = `${150 + pos.x}px`;
        dot.style.top = `${150 + pos.y}px`;
      }
    });
    
    // Target plays solo for 1.5 seconds
    this.targetSource.startRhythm();
    
    await this.sleep(1500);
    
    // All sources join in for remaining 1.5 seconds
    this.sources.forEach(source => {
      if (!source.isTarget) {
        source.startRhythm();
      }
    });
    
    await this.sleep(1500);
    
    this.phaseHandoff();
  }

  // ========================================
  // PHASE 2: HANDOFF (3-4s)
  // Dots begin moving and fade out
  // ========================================
  async phaseHandoff() {
    this.state.phase = 'handoff';
    this.updatePhaseIndicator('track the target as it moves');
    
    this.phaseStartTime = Date.now();
    
    // Start movement animation
    const animate = () => {
      if (this.state.phase === 'handoff' || this.state.phase === 'tracking') {
        this.updateDotPositions();
        this.animationFrameId = requestAnimationFrame(animate);
      }
    };
    animate();
    
    // Fade dots out over 1 second
    this.fadeDots(1000, 0);
    
    await this.sleep(1000);
    
    this.phaseTracking();
  }

  // ========================================
  // PHASE 3: TRACKING (4-9s)
  // Blind tracking with audio only
  // ========================================
  async phaseTracking() {
    this.state.phase = 'tracking';
    this.updatePhaseIndicator('tracking...');
    
    // Dots are invisible, movement continues
    await this.sleep(5000);
    
    this.phaseReveal();
  }

  // ========================================
  // PHASE 4: REVEAL (9s)
  // Audio stops, dots reappear
  // ========================================
  async phaseReveal() {
    this.state.phase = 'reveal';
    this.updatePhaseIndicator('where did the target end?');
    
    // Stop all audio
    this.sources.forEach(source => source.stopRhythm());
    
    // Stop animation
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
    }
    
    // Show final positions
    this.drawDots('reveal');
    
    // Set final positions
    this.sources.forEach((source, index) => {
      const path = this.paths[index];
      const finalPos = path[path.length - 1];
      
      const diagram = document.getElementById('spatial-diagram');
      const dot = diagram.querySelector(`.sound-source[data-index="${index}"]`);
      if (dot) {
        dot.style.left = `${150 + finalPos.x}px`;
        dot.style.top = `${150 + finalPos.y}px`;
        dot.style.opacity = 1;
      }
    });
    
    this.state.phase = 'guess';
    document.getElementById('btn-play').disabled = true;
  }

  // ========================================
  // PHASE 5: GUESS & FEEDBACK
  // ========================================
  handleGuess(selectedIndex) {
    if (this.state.phase !== 'guess') return;
    
    const diagram = document.getElementById('spatial-diagram');
    const dots = diagram.querySelectorAll('.sound-source');
    
    // Remove click handlers
    dots.forEach(dot => {
      dot.classList.remove('source-clickable');
      dot.style.cursor = 'default';
    });
    
    const isCorrect = this.sources[selectedIndex].isTarget;
    
    this.state.trials++;
    if (isCorrect) {
      this.state.correct++;
    }
    
    this.updateStats();
    
    // Visual feedback
    const selectedDot = dots[selectedIndex];
    selectedDot.classList.add('source-selected');
    
    if (isCorrect) {
      this.showFeedback('success', 'correct!');
    } else {
      this.showFeedback('error', 'incorrect');
      
      // Reveal the actual target
      const targetIndex = this.sources.findIndex(s => s.isTarget);
      dots[targetIndex].classList.add('source-revealed');
      
      // Draw path trace
      this.drawPathTrace(targetIndex);
    }
    
    this.updatePhaseIndicator('');
    document.getElementById('btn-next').disabled = false;
  }

  drawPathTrace(targetIndex) {
    const svg = document.getElementById('path-trace');
    svg.innerHTML = '';
    
    const path = this.paths[targetIndex];
    
    // Create path element
    const pathEl = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    
    let d = '';
    path.forEach((pos, i) => {
      const x = 150 + pos.x;
      const y = 150 + pos.y;
      
      if (i === 0) {
        d += `M ${x} ${y}`;
      } else {
        d += ` L ${x} ${y}`;
      }
    });
    
    pathEl.setAttribute('d', d);
    pathEl.setAttribute('stroke', '#20269D');
    pathEl.setAttribute('stroke-width', '2');
    pathEl.setAttribute('stroke-dasharray', '5,5');
    pathEl.setAttribute('fill', 'none');
    pathEl.setAttribute('opacity', '0.6');
    
    svg.appendChild(pathEl);
  }

  showFeedback(type, message) {
    const feedbackMsg = document.getElementById('feedback-msg');
    feedbackMsg.textContent = message;
    feedbackMsg.className = 'feedback-msg';
    if (type) {
      feedbackMsg.classList.add(type);
    }
  }

  updateStats() {
    document.getElementById('stat-trials').textContent = this.state.trials;
    document.getElementById('stat-correct').textContent = this.state.correct;
    const accuracy = this.state.trials > 0 
      ? Math.round((this.state.correct / this.state.trials) * 100) 
      : 0;
    document.getElementById('stat-accuracy').textContent = accuracy + '%';
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async play() {
    if (this.audioCtx.state === 'suspended') {
      await this.audioCtx.resume();
    }
    
    // Generate sources and paths
    this.createSources();
    this.generatePaths();
    
    // Clear previous feedback
    this.showFeedback('', '');
    
    // Clear path trace
    document.getElementById('path-trace').innerHTML = '';
    
    // Start Phase 1
    this.phaseIdentity();
    
    document.getElementById('btn-play').disabled = true;
    document.getElementById('btn-next').disabled = true;
  }

  next() {
    // Reset for next trial
    this.state.phase = 'idle';
    this.sources.forEach(source => source.stopRhythm());
    
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
    }
    
    const diagram = document.getElementById('spatial-diagram');
    const oldDots = diagram.querySelectorAll('.sound-source');
    oldDots.forEach(dot => dot.remove());
    
    document.getElementById('path-trace').innerHTML = '';
    this.updatePhaseIndicator('');
    this.showFeedback('', '');
    
    document.getElementById('btn-play').disabled = false;
    document.getElementById('btn-next').disabled = true;
  }

  applyPreset(difficulty) {
    const preset = this.state.presets[difficulty];
    if (!preset) return;
    
    this.state.difficulty = difficulty;
    this.state.numSources = preset.sources;
    this.state.complexity = preset.complexity;
    this.state.movementSpeed = preset.speed;
    
    // Update UI
    document.querySelectorAll('[data-sources]').forEach(btn => {
      btn.classList.toggle('on', parseInt(btn.dataset.sources) === preset.sources);
    });
    
    document.querySelectorAll('[data-complexity]').forEach(btn => {
      btn.classList.toggle('on', btn.dataset.complexity === preset.complexity);
    });
    
    document.getElementById('movement-speed').value = preset.speed;
    document.getElementById('movement-speed-val').textContent = preset.speed + 'x';
  }
}

// ========================================
// UI INITIALIZATION
// ========================================

let game;

async function init() {
  game = new SpatialGame();
  await game.init();
  
  // Setup difficulty buttons
  document.querySelectorAll('[data-difficulty]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('[data-difficulty]').forEach(b => b.classList.remove('on'));
      btn.classList.add('on');
      game.applyPreset(btn.dataset.difficulty);
    });
  });
  
  // Setup custom controls
  document.querySelectorAll('[data-sources]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('[data-sources]').forEach(b => b.classList.remove('on'));
      btn.classList.add('on');
      game.state.numSources = parseInt(btn.dataset.sources);
    });
  });
  
  document.querySelectorAll('[data-complexity]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('[data-complexity]').forEach(b => b.classList.remove('on'));
      btn.classList.add('on');
      game.state.complexity = btn.dataset.complexity;
    });
  });
  
  document.getElementById('movement-speed').addEventListener('input', (e) => {
    game.state.movementSpeed = parseFloat(e.target.value);
    document.getElementById('movement-speed-val').textContent = e.target.value + 'x';
  });
  
  // Setup control buttons
  document.getElementById('btn-play').addEventListener('click', () => game.play());
  document.getElementById('btn-next').addEventListener('click', () => game.next());
  
  // Setup custom toggle
  document.getElementById('custom-toggle').addEventListener('click', () => {
    const content = document.getElementById('custom-content');
    const icon = document.getElementById('custom-icon');
    const isActive = content.classList.toggle('active');
    icon.textContent = isActive ? '▲' : '▼';
  });
  
  // Apply default preset
  game.applyPreset('easy');
  
  console.log('✓ UI initialized');
}

window.addEventListener('load', init);
