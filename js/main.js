// ========================================
// MAIN LOGIC - COCKTAIL PARTY PROBLEM
// UI, Game Flow, State Management
// ========================================

// Word sets manifest
const WORD_ASSETS = {
  colors: ['red', 'blue', 'green', 'yellow', 'orange', 'purple', 'pink', 'brown', 
           'black', 'white', 'gray', 'silver', 'gold', 'violet', 'indigo', 'cyan', 
           'magenta', 'turquoise', 'lime', 'maroon'],
  numbers: ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten']
};

// Masker types
const MASKER_TYPES = ['nature', 'traffic', 'voices'];

// Global instances
let audioEngine;
let assetLoader;

// Game state
const state = {
  trials: 0,
  correct: 0,
  currentWord: null,
  choices: [],
  attempts: 0,
  
  // Settings
  difficulty: 'easy',
  wordSet: 'colors',
  maskerCount: 1,
  targetGain: 1.0,
  snr: 10, // Signal-to-Noise Ratio in dB
  
  // Visuals
  spectrogramEnabled: false,
  spatialEnabled: false,
  
  // Difficulty presets
  presets: {
    easy:   { snr: 10,  maskerCount: 1, maskerTypes: ['nature'] },
    medium: { snr: -2.5,   maskerCount: 2, maskerTypes: ['nature', 'traffic'] },
    hard:   { snr: -10,  maskerCount: 3, maskerTypes: ['nature', 'traffic', 'voices'] }
  }
};

// Spectrogram animation
let spectrogramAnimationId = null;
let dataArray = null;

// ========================================
// INITIALIZATION
// ========================================

async function init() {
  audioEngine = new AudioEngine();
  
  await audioEngine.init();
  assetLoader = new AssetLoader(audioEngine.audioCtx);
  
  // Pre-load a sample of words (lazy loading for others)
  await preloadAssets();
  
  // Setup UI
  setupDifficultyButtons();
  setupWordSetButtons();
  setupMaskerCountButtons();
  setupControlButtons();
  setupVisualToggles();
  setupSliders();
  setupAdvancedToggle();
  
  // Apply default preset
  applyPreset('easy');
  updateMaskerConfigs();
  updateSpatialDiagram();

  
  console.log('✓ Cocktail Party Problem initialized');
}

async function preloadAssets() {
  // Load maskers
  for (const type of MASKER_TYPES) {
    await assetLoader.loadMasker(type);
  }
  
  // Load a few sample target words
  const sampleWords = ['red', 'blue', 'one', 'two'];
  for (const word of sampleWords) {
    for (let variant = 0; variant < 3; variant++) {
      await assetLoader.loadTargetWord(word, variant);
    }
  }
  
  console.log('✓ Core assets pre-loaded');
}

// ========================================
// UI SETUP
// ========================================

function setupDifficultyButtons() {
  document.querySelectorAll('[data-difficulty]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('[data-difficulty]').forEach(b => b.classList.remove('on'));
      btn.classList.add('on');
      state.difficulty = btn.dataset.difficulty;
      
      if (state.difficulty !== 'custom') {
        applyPreset(state.difficulty);
      } else {
        document.getElementById('advanced-content').classList.add('active');
        document.getElementById('advanced-icon').textContent = '▲';
      }
    });
  });
}

function setupWordSetButtons() {
  document.querySelectorAll('[data-wordset]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('[data-wordset]').forEach(b => b.classList.remove('on'));
      btn.classList.add('on');
      state.wordSet = btn.dataset.wordset;
    });
  });
}

function setupMaskerCountButtons() {
  document.querySelectorAll('[data-masker-count]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('[data-masker-count]').forEach(b => b.classList.remove('on'));
      btn.classList.add('on');
      state.maskerCount = parseInt(btn.dataset.maskerCount);
      updateMaskerConfigs();
      updateSpatialDiagram();
    });
  });
}

function setupControlButtons() {
  document.getElementById('btn-play').addEventListener('click', play);
  document.getElementById('btn-repeat').addEventListener('click', repeat);
  document.getElementById('btn-next').addEventListener('click', next);
}

function setupVisualToggles() {
  document.getElementById('toggle-spectrogram').addEventListener('click', () => {
    state.spectrogramEnabled = !state.spectrogramEnabled;
    const canvas = document.getElementById('spectrogram');
    const placeholder = document.getElementById('spectrogram-placeholder');
    const btn = document.getElementById('toggle-spectrogram');
    
    if (state.spectrogramEnabled) {
      canvas.style.display = 'block';
      placeholder.style.display = 'none';
      btn.classList.add('on');
      btn.textContent = 'hide spectrogram';
    } else {
      canvas.style.display = 'none';
      placeholder.style.display = 'block';
      btn.classList.remove('on');
      btn.textContent = 'show spectrogram';
      stopSpectrogram();
    }
  });

  document.getElementById('toggle-spatial').addEventListener('click', () => {
    state.spatialEnabled = !state.spatialEnabled;
    const container = document.getElementById('spatial-container');
    const btn = document.getElementById('toggle-spatial');
    
    if (state.spatialEnabled) {
      container.style.display = 'block';
      btn.classList.add('on');
      btn.textContent = 'hide spatial';
      updateSpatialDiagram();
    } else {
      container.style.display = 'none';
      btn.classList.remove('on');
      btn.textContent = 'show spatial';
    }
  });
}

function setupSliders() {
  const targetVol = document.getElementById('target-volume');
  targetVol.addEventListener('input', (e) => {
    state.targetGain = parseFloat(e.target.value);
    document.getElementById('target-volume-val').textContent = e.target.value;
  });

  const snrSlider = document.getElementById('snr');
  snrSlider.addEventListener('input', (e) => {
    state.snr = parseFloat(e.target.value);
    document.getElementById('snr-val').textContent = e.target.value + ' dB';
  });
}

function setupAdvancedToggle() {
  document.getElementById('advanced-toggle').addEventListener('click', () => {
    const content = document.getElementById('advanced-content');
    const icon = document.getElementById('advanced-icon');
    const isActive = content.classList.toggle('active');
    icon.textContent = isActive ? '▲' : '▼';
  });
}

// ========================================
// DIFFICULTY PRESETS
// ========================================

function applyPreset(difficulty) {
  const preset = state.presets[difficulty];
  if (!preset) return;
  
  state.snr = preset.snr;
  state.maskerCount = preset.maskerCount;
  
  // Update UI
  document.getElementById('snr').value = preset.snr;
  document.getElementById('snr-val').textContent = preset.snr + ' dB';
  
  document.querySelectorAll('[data-masker-count]').forEach(b => b.classList.remove('on'));
  document.querySelector(`[data-masker-count="${preset.maskerCount}"]`).classList.add('on');
  
  updateMaskerConfigs();
  
  // Set masker types from preset
  setTimeout(() => {
    preset.maskerTypes.forEach((type, index) => {
      const select = document.getElementById(`masker-type-${index}`);
      if (select) select.value = type;
    });
  }, 50);
  
  updateSpatialDiagram();
}

// ========================================
// MASKER CONFIGURATION UI
// ========================================

function updateMaskerConfigs() {
  const container = document.getElementById('masker-configs');
  container.innerHTML = '';
  
  for (let i = 0; i < state.maskerCount; i++) {
    const config = document.createElement('div');
    config.className = 'masker-config';
    config.innerHTML = `
      <div class="gen-row" style="margin-bottom: 0;">
        <span class="gen-row-label">masker ${i + 1} →</span>
        <select class="gen-select" id="masker-type-${i}">
          <option value="nature">nature</option>
          <option value="traffic">traffic</option>
          <option value="voices">voices</option>
        </select>
      </div>
    `;
    container.appendChild(config);
  }
}

// ========================================
// SPATIAL DIAGRAM
// ========================================

function updateSpatialDiagram() {
  const diagram = document.getElementById('spatial-diagram');
  if (!diagram) return;
  
  const oldSources = diagram.querySelectorAll('.sound-source');
  oldSources.forEach(s => s.remove());
  
  // Target (center)
  const target = document.createElement('div');
  target.className = 'sound-source source-target';
  target.style.left = '50%';
  target.style.top = '35%';
  diagram.appendChild(target);
  
  // Masker positions
  const positions = [
    { left: '15%', top: '50%' },  // Left
    { left: '25%', top: '25%' },  // Front-left
    { left: '75%', top: '25%' },  // Front-right
    { left: '50%', top: '75%' }   // Behind
  ];
  
  for (let i = 0; i < state.maskerCount; i++) {
    const masker = document.createElement('div');
    masker.className = 'sound-source source-masker';
    masker.style.left = positions[i].left;
    masker.style.top = positions[i].top;
    diagram.appendChild(masker);
  }
}

// ========================================
// SPECTROGRAM
// ========================================

function startSpectrogram() {
  if (!state.spectrogramEnabled) return;
  
  const analyser = audioEngine.getAnalyser();
  const bufferLength = analyser.frequencyBinCount;
  dataArray = new Uint8Array(bufferLength);
  
  const canvas = document.getElementById('spectrogram');
  const ctx = canvas.getContext('2d');
  
  function draw() {
    if (!state.spectrogramEnabled) return;
    
    spectrogramAnimationId = requestAnimationFrame(draw);
    analyser.getByteFrequencyData(dataArray);
    
    // Scroll canvas left
    const temp = ctx.getImageData(2, 0, canvas.width - 2, canvas.height);
    ctx.putImageData(temp, 0, 0);
    
    // Draw new frequency slice
    const maxFreq = Math.floor(bufferLength * 0.5); // Up to 8kHz
    for (let i = 0; i < maxFreq; i++) {
      const value = dataArray[i];
      const y = canvas.height - (i / maxFreq) * canvas.height;
      
      // Simple color mapping
      const brightness = Math.floor(value);
      ctx.fillStyle = `rgb(${brightness}, ${brightness}, ${brightness})`;
      ctx.fillRect(canvas.width - 2, y, 2, canvas.height / maxFreq);
    }
  }
  
  draw();
}

function stopSpectrogram() {
  if (spectrogramAnimationId) {
    cancelAnimationFrame(spectrogramAnimationId);
    spectrogramAnimationId = null;
  }
}

// ========================================
// GAME LOGIC
// ========================================

async function play() {
  audioEngine.resume();
  
  const words = WORD_ASSETS[state.wordSet];
  
  // Select random target word
  state.currentWord = words[Math.floor(Math.random() * words.length)];
  
  // Load target word if not already loaded
  let targetBuffer = assetLoader.getTargetBuffer(state.currentWord);
  if (!targetBuffer) {
    // Lazy load
    const variant = Math.floor(Math.random() * 3);
    targetBuffer = await assetLoader.loadTargetWord(state.currentWord, variant);
  }
  
  if (!targetBuffer) {
    showFeedback('error', 'Failed to load audio file');
    return;
  }
  
  // Select 3 random distractors
  const distractors = words.filter(w => w !== state.currentWord);
  const shuffled = distractors.sort(() => Math.random() - 0.5);
  state.choices = [state.currentWord, ...shuffled.slice(0, 3)].sort(() => Math.random() - 0.5);
  
  state.attempts = 0;
  
  // Create choice buttons
  const choicesContainer = document.getElementById('choice-buttons');
  choicesContainer.innerHTML = '';
  
  state.choices.forEach(word => {
    const btn = document.createElement('button');
    btn.className = 'choice-btn';
    btn.textContent = word.charAt(0).toUpperCase() + word.slice(1);
    btn.onclick = () => checkAnswer(word);
    choicesContainer.appendChild(btn);
  });
  
  // Load masker buffers
  const maskerBuffers = [];
  for (let i = 0; i < state.maskerCount; i++) {
    const typeSelect = document.getElementById(`masker-type-${i}`);
    const type = typeSelect ? typeSelect.value : 'nature';
    
    let maskerBuffer = assetLoader.getMaskerBuffer(type);
    if (maskerBuffer) {
      // Get random 4-second excerpt
      maskerBuffer = assetLoader.getRandomExcerpt(maskerBuffer, 4.0);
    }
    maskerBuffers.push(maskerBuffer);
  }
  
  // Calculate masker gain based on SNR
  const maskerGain = audioEngine.calculateMaskerGain(state.snr, state.targetGain);
  
  // Play trial
  const duration = audioEngine.playTrial(targetBuffer, maskerBuffers, {
    targetGain: state.targetGain,
    maskerGain: maskerGain
  });
  
  // Update UI
  document.getElementById('btn-play').disabled = true;
  document.getElementById('btn-repeat').disabled = false;
  document.getElementById('feedback-container').innerHTML = '';
  
  // Start spectrogram
  if (state.spectrogramEnabled) {
    startSpectrogram();
  }
  
  // Auto-enable controls after playback
  setTimeout(() => {
    if (state.spectrogramEnabled) stopSpectrogram();
  }, duration * 1000);
}

function repeat() {
  // Replay same word
  play();
}

function next() {
  audioEngine.stopAll();
  stopSpectrogram();
  
  document.getElementById('btn-play').disabled = false;
  document.getElementById('btn-repeat').disabled = true;
  document.getElementById('btn-next').disabled = true;
  document.getElementById('feedback-container').innerHTML = '';
  document.getElementById('choice-buttons').innerHTML = '';
}

function checkAnswer(selected) {
  state.attempts++;
  
  if (selected === state.currentWord) {
    // Correct!
    showFeedback('success', 'correct');
    state.correct++;
    state.trials++;
    updateStats();
    
    const buttons = document.querySelectorAll('.choice-btn');
    buttons.forEach(btn => {
      if (btn.textContent.toLowerCase() === state.currentWord.toLowerCase()) {
        btn.classList.add('correct');
      }
      btn.disabled = true;
    });
    
    document.getElementById('btn-next').disabled = false;
    
  } else if (state.attempts < 2) {
    // First incorrect - allow retry
    showFeedback('error', 'try again');
    
    const buttons = document.querySelectorAll('.choice-btn');
    buttons.forEach(btn => {
      if (btn.textContent.toLowerCase() === selected.toLowerCase()) {
        btn.classList.add('incorrect');
        setTimeout(() => btn.classList.remove('incorrect'), 1000);
      }
    });
    
  } else {
    // Second incorrect - reveal
    showFeedback('error', `answer: ${state.currentWord}`);
    state.trials++;
    updateStats();
    
    const buttons = document.querySelectorAll('.choice-btn');
    buttons.forEach(btn => {
      if (btn.textContent.toLowerCase() === state.currentWord.toLowerCase()) {
        btn.classList.add('correct');
      }
      btn.disabled = true;
    });
    
    document.getElementById('btn-next').disabled = false;
  }
}

function showFeedback(type, message) {
  const container = document.getElementById('feedback-container');
  container.innerHTML = `<div class="feedback-msg ${type}">${message}</div>`;
}

function updateStats() {
  document.getElementById('stat-trials').textContent = state.trials;
  document.getElementById('stat-correct').textContent = state.correct;
  const accuracy = state.trials > 0 ? Math.round((state.correct / state.trials) * 100) : 0;
  document.getElementById('stat-accuracy').textContent = accuracy + '%';
}

// ========================================
// INIT ON LOAD
// ========================================

window.addEventListener('load', init);
