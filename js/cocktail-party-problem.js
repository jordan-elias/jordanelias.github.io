// ========================================
// COCKTAIL PARTY PROBLEM - MODULE 1
// Word Identification in Noise
// ========================================

const AudioContext = window.AudioContext || window.webkitAudioContext;
let audioCtx;
let resonanceAudioScene;

// Audio buffers for masker files
const audioBuffers = {
  party: null,
  traffic: null,
  nature: null
};

// Module state
const state = {
  trials: 0,
  correct: 0,
  currentWord: null,
  choices: [],
  attempts: 0,
  sources: [],
  isPlaying: false,
  difficulty: 'easy',
  wordSet: 'colors',
  maskerCount: 1,
  
  wordSets: {
    colors: ['red', 'blue', 'green', 'yellow', 'orange', 'purple', 'pink', 'brown', 'black', 'white',
            'gray', 'silver', 'gold', 'violet', 'indigo', 'cyan', 'magenta', 'turquoise', 'lime', 'maroon'],
    numbers: ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten']
  },
  
  difficulties: {
    easy: { snr: 10, maskerCount: 1, maskerType: 'pink', speed: 0.85 },
    medium: { snr: 0, maskerCount: 2, maskerType: 'speech', speed: 1.0 },
    hard: { snr: -5, maskerCount: 3, maskerType: 'party', speed: 1.0 }
  },
  
  maskerTypes: {
    pink: 'Pink Noise',
    speech: 'Speech-Shaped Noise',
    party: 'Party Babble',
    traffic: 'Traffic Sounds',
    nature: 'Nature Sounds'
  }
};

// Spectrogram
let spectrogramAnalyser = null;
let spectrogramAnimationId = null;
let spectrogramVisible = false;
let spatialVisible = false;

// ========================================
// INITIALIZATION
// ========================================

function initAudio() {
  if (!audioCtx) {
    audioCtx = new AudioContext();
    
    // Initialize Resonance Audio
    resonanceAudioScene = new ResonanceAudio(audioCtx);
    resonanceAudioScene.output.connect(audioCtx.destination);
    
    // Set room properties for realistic acoustics
    resonanceAudioScene.setRoomProperties({
      width: 10,
      height: 3,
      depth: 8
    }, {
      left: 'brick-bare',
      right: 'brick-bare',
      front: 'brick-bare',
      back: 'brick-bare',
      down: 'wood-panel',
      up: 'acoustic-ceiling-tiles'
    });
    
    // Load audio files
    loadAudioFiles();
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
}

async function loadAudioFiles() {
  const files = {
    party: '/audio/party.mp3',
    traffic: '/audio/traffic.mp3',
    nature: '/audio/nature.mp3'
  };

  for (const [key, url] of Object.entries(files)) {
    try {
      const response = await fetch(url);
      const arrayBuffer = await response.arrayBuffer();
      audioBuffers[key] = await audioCtx.decodeAudioData(arrayBuffer);
      console.log(`✓ Loaded ${key} audio file`);
    } catch (error) {
      console.warn(`Could not load ${key} audio file:`, error);
    }
  }
}

function init() {
  // Difficulty buttons
  document.querySelectorAll('[data-difficulty]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('[data-difficulty]').forEach(b => b.classList.remove('on'));
      btn.classList.add('on');
      state.difficulty = btn.dataset.difficulty;
      
      if (state.difficulty !== 'custom') {
        applyDifficultyPreset(state.difficulty);
      } else {
        // Open advanced controls for custom
        document.getElementById('advanced-content').classList.add('active');
        document.getElementById('advanced-icon').textContent = '▲';
      }
    });
  });

  // Word set buttons
  document.querySelectorAll('[data-wordset]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('[data-wordset]').forEach(b => b.classList.remove('on'));
      btn.classList.add('on');
      state.wordSet = btn.dataset.wordset;
    });
  });

  // Masker count buttons
  document.querySelectorAll('[data-masker-count]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('[data-masker-count]').forEach(b => b.classList.remove('on'));
      btn.classList.add('on');
      state.maskerCount = parseInt(btn.dataset.maskerCount);
      updateMaskerConfigs();
      updateSpatialDiagram();
    });
  });

  // Main control buttons
  document.getElementById('btn-play').addEventListener('click', play);
  document.getElementById('btn-repeat').addEventListener('click', repeat);
  document.getElementById('btn-next').addEventListener('click', next);

  // Advanced controls toggle
  document.getElementById('advanced-toggle').addEventListener('click', () => {
    const content = document.getElementById('advanced-content');
    const icon = document.getElementById('advanced-icon');
    const isActive = content.classList.toggle('active');
    icon.textContent = isActive ? '▲' : '▼';
  });

  // Sliders
  document.getElementById('target-volume').addEventListener('input', (e) => {
    document.getElementById('target-volume-val').textContent = e.target.value;
  });

  document.getElementById('playback-speed').addEventListener('input', (e) => {
    document.getElementById('playback-speed-val').textContent = e.target.value + '×';
  });

  // Visualization toggles
  document.getElementById('toggle-spectrogram').addEventListener('click', () => {
    spectrogramVisible = !spectrogramVisible;
    const canvas = document.getElementById('spectrogram');
    const btn = document.getElementById('toggle-spectrogram');
    
    if (spectrogramVisible) {
      canvas.style.display = 'block';
      btn.classList.add('on');
      btn.textContent = 'hide spectrogram';
      if (!spectrogramAnalyser) setupSpectrogram();
    } else {
      canvas.style.display = 'none';
      btn.classList.remove('on');
      btn.textContent = 'show spectrogram';
      stopSpectrogram();
    }
  });

  document.getElementById('toggle-spatial').addEventListener('click', () => {
    spatialVisible = !spatialVisible;
    const container = document.getElementById('spatial-container');
    const btn = document.getElementById('toggle-spatial');
    
    if (spatialVisible) {
      container.style.display = 'block';
      btn.classList.add('on');
      btn.textContent = 'hide spatial diagram';
      updateSpatialDiagram();
    } else {
      container.style.display = 'none';
      btn.classList.remove('on');
      btn.textContent = 'show spatial diagram';
    }
  });

  // Initialize masker configs and spatial diagram
  updateMaskerConfigs();
  updateSpatialDiagram();
  
  // Apply default difficulty
  applyDifficultyPreset('easy');

  // Wait for speech synthesis voices
  if (speechSynthesis.onvoiceschanged !== undefined) {
    speechSynthesis.onvoiceschanged = () => {
      console.log('Speech synthesis voices loaded');
    };
  }
}

// ========================================
// DIFFICULTY PRESETS
// ========================================

function applyDifficultyPreset(difficulty) {
  const preset = state.difficulties[difficulty];
  
  // Update masker count
  state.maskerCount = preset.maskerCount;
  document.querySelectorAll('[data-masker-count]').forEach(b => b.classList.remove('on'));
  document.querySelector(`[data-masker-count="${preset.maskerCount}"]`).classList.add('on');
  
  // Update playback speed
  document.getElementById('playback-speed').value = preset.speed;
  document.getElementById('playback-speed-val').textContent = preset.speed + '×';
  
  // Update masker configs
  updateMaskerConfigs();
  
  // Set all maskers to preset type
  setTimeout(() => {
    for (let i = 0; i < preset.maskerCount; i++) {
      const select = document.getElementById(`masker-type-${i}`);
      if (select) select.value = preset.maskerType;
    }
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
      <div class="masker-config-title">masker ${i + 1}</div>
      <div class="gen-row">
        <span class="gen-row-label">type →</span>
        <select class="gen-select" id="masker-type-${i}">
          <option value="pink">Pink Noise</option>
          <option value="speech">Speech-Shaped Noise</option>
          <option value="party">Party Sounds</option>
          <option value="traffic">Traffic Sounds</option>
          <option value="nature">Nature Sounds</option>
        </select>
      </div>
      <div class="lab-ctrl">
        <input type="range" id="masker-vol-${i}" min="0" max="1" step="0.1" value="0.5">
        <div class="lab-ctrl-bottom">
          <span class="lab-ctrl-label">volume</span>
          <span class="lab-ctrl-val" id="masker-vol-${i}-val">0.5</span>
        </div>
      </div>
    `;
    container.appendChild(config);
    
    // Add event listener for volume slider
    document.getElementById(`masker-vol-${i}`).addEventListener('input', (e) => {
      document.getElementById(`masker-vol-${i}-val`).textContent = e.target.value;
    });
  }
}

// ========================================
// SPATIAL DIAGRAM
// ========================================

function updateSpatialDiagram() {
  const diagram = document.getElementById('spatial-diagram');
  if (!diagram) return;
  
  // Remove old sources
  const oldSources = diagram.querySelectorAll('.sound-source');
  oldSources.forEach(s => s.remove());
  
  // Add target (center)
  const target = document.createElement('div');
  target.className = 'sound-source source-target';
  target.style.left = '50%';
  target.style.top = '50%';
  diagram.appendChild(target);
  
  // Masker positions (azimuth angles in degrees)
  const positions = [
    { left: '20%', top: '50%', angle: -90 },   // Left
    { left: '30%', top: '30%', angle: -60 },   // Front-left
    { left: '70%', top: '30%', angle: 60 },    // Front-right
    { left: '50%', top: '80%', angle: 180 }    // Behind
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
// AUDIO GENERATION
// ========================================

function getRandomExcerpt(buffer, duration = 8) {
  if (!buffer) return null;
  
  const sampleRate = audioCtx.sampleRate;
  const excerptLength = sampleRate * duration;
  const maxStart = buffer.length - excerptLength;
  
  if (maxStart <= 0) return buffer; // File is shorter than excerpt
  
  const startSample = Math.floor(Math.random() * maxStart);
  
  const excerptBuffer = audioCtx.createBuffer(
    buffer.numberOfChannels,
    excerptLength,
    sampleRate
  );
  
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const sourceData = buffer.getChannelData(channel);
    const excerptData = excerptBuffer.getChannelData(channel);
    for (let i = 0; i < excerptLength; i++) {
      excerptData[i] = sourceData[startSample + i];
    }
  }
  
  return excerptBuffer;
}

function createPinkNoise(duration) {
  const sampleRate = audioCtx.sampleRate;
  const bufferSize = sampleRate * duration;
  const buffer = audioCtx.createBuffer(1, bufferSize, sampleRate);
  const output = buffer.getChannelData(0);
  
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  
  for (let i = 0; i < bufferSize; i++) {
    const white = Math.random() * 2 - 1;
    b0 = 0.99886 * b0 + white * 0.0555179;
    b1 = 0.99332 * b1 + white * 0.0750759;
    b2 = 0.96900 * b2 + white * 0.1538520;
    b3 = 0.86650 * b3 + white * 0.3104856;
    b4 = 0.55000 * b4 + white * 0.5329522;
    b5 = -0.7616 * b5 - white * 0.0168980;
    output[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362;
    output[i] *= 0.11;
    b6 = white * 0.115926;
  }
  
  return buffer;
}

function createSpeechShapedNoise(duration) {
  const sampleRate = audioCtx.sampleRate;
  const bufferSize = sampleRate * duration;
  const buffer = audioCtx.createBuffer(1, bufferSize, sampleRate);
  const output = buffer.getChannelData(0);
  
  for (let i = 0; i < bufferSize; i++) {
    output[i] = (Math.random() * 2 - 1) * 0.1;
  }
  
  return buffer;
}

function getMaskerBuffer(type) {
  switch(type) {
    case 'pink':
      return createPinkNoise(8);
    case 'speech':
      return createSpeechShapedNoise(8);
    case 'party':
      return getRandomExcerpt(audioBuffers.party, 8) || createPinkNoise(8);
    case 'traffic':
      return getRandomExcerpt(audioBuffers.traffic, 8) || createPinkNoise(8);
    case 'nature':
      return getRandomExcerpt(audioBuffers.nature, 8) || createPinkNoise(8);
    default:
      return createPinkNoise(8);
  }
}

// ========================================
// SPECTROGRAM
// ========================================

function setupSpectrogram() {
  spectrogramAnalyser = audioCtx.createAnalyser();
  spectrogramAnalyser.fftSize = 2048;
  spectrogramAnalyser.smoothingTimeConstant = 0.8;
  spectrogramAnalyser.connect(audioCtx.destination);
}

function drawSpectrogram() {
  if (!spectrogramAnalyser || !spectrogramVisible) return;
  
  const canvas = document.getElementById('spectrogram');
  const canvasCtx = canvas.getContext('2d');
  const width = canvas.width;
  const height = canvas.height;
  
  const bufferLength = spectrogramAnalyser.frequencyBinCount;
  const dataArray = new Uint8Array(bufferLength);
  
  function draw() {
    if (!spectrogramVisible) return;
    spectrogramAnimationId = requestAnimationFrame(draw);
    
    spectrogramAnalyser.getByteFrequencyData(dataArray);
    
    // Scroll existing content left
    const imageData = canvasCtx.getImageData(1, 0, width - 1, height);
    canvasCtx.putImageData(imageData, 0, 0);
    
    // Draw new column (show up to 8kHz)
    const maxFreqIndex = Math.floor(bufferLength * 0.5);
    for (let i = 0; i < maxFreqIndex; i++) {
      const value = dataArray[i];
      const percent = value / 255;
      const y = height - (i / maxFreqIndex) * height;
      
      // Simple grayscale
      const brightness = Math.floor(percent * 255);
      canvasCtx.fillStyle = `rgb(${brightness}, ${brightness}, ${brightness})`;
      canvasCtx.fillRect(width - 1, y, 1, height / maxFreqIndex);
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
// PLAYBACK
// ========================================

function play() {
  initAudio();
  stopPlayback();
  
  const words = state.wordSets[state.wordSet];
  
  // Select random target word
  state.currentWord = words[Math.floor(Math.random() * words.length)];
  
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
  
  // Synthesize and play
  synthesizeAndPlay();
  
  // Update UI
  document.getElementById('btn-play').disabled = true;
  document.getElementById('btn-repeat').disabled = false;
  document.getElementById('feedback-container').innerHTML = '';
  
  // Start spectrogram if visible
  if (spectrogramVisible) {
    drawSpectrogram();
  }
}

function repeat() {
  synthesizeAndPlay();
}

function next() {
  stopPlayback();
  document.getElementById('btn-play').disabled = false;
  document.getElementById('btn-repeat').disabled = true;
  document.getElementById('btn-next').disabled = true;
  document.getElementById('feedback-container').innerHTML = '';
  document.getElementById('choice-buttons').innerHTML = '';
}

function synthesizeAndPlay() {
  // Create mixer
  const mixer = audioCtx.createGain();
  mixer.gain.value = 1.0;
  
  if (spectrogramAnalyser) {
    mixer.connect(spectrogramAnalyser);
  } else {
    mixer.connect(audioCtx.destination);
  }
  
  // Synthesize target word
  const utterance = new SpeechSynthesisUtterance(state.currentWord);
  const speed = parseFloat(document.getElementById('playback-speed').value);
  utterance.rate = speed;
  
  const voices = speechSynthesis.getVoices().filter(v => v.lang.startsWith('en'));
  if (voices.length > 0) {
    utterance.voice = voices[Math.floor(Math.random() * voices.length)];
  }
  
  // Speak the word (unfortunately Web Speech API can't be routed through Web Audio easily)
  speechSynthesis.speak(utterance);
  
  // Play maskers through spatial audio
  playMaskers(mixer);
  
  state.isPlaying = true;
}

function playMaskers(destination) {
  const positions = [-90, -60, 60, 180]; // Azimuth angles
  
  for (let i = 0; i < state.maskerCount; i++) {
    const typeSelect = document.getElementById(`masker-type-${i}`);
    const volSlider = document.getElementById(`masker-vol-${i}`);
    
    if (!typeSelect || !volSlider) continue;
    
    const type = typeSelect.value;
    const volume = parseFloat(volSlider.value);
    
    const buffer = getMaskerBuffer(type);
    if (!buffer) continue;
    
    const source = audioCtx.createBufferSource();
    source.buffer = buffer;
    
    // Create Resonance Audio source
    const audioSource = resonanceAudioScene.createSource();
    
    // Position source at azimuth angle
    const angle = positions[i] * Math.PI / 180;
    const x = Math.sin(angle) * 2;
    const z = -Math.cos(angle) * 2;
    audioSource.setPosition(x, 0, z);
    
    // Create gain for volume control
    const gain = audioCtx.createGain();
    gain.gain.value = volume;
    
    // Connect: source -> gain -> audioSource
    source.connect(gain);
    gain.connect(audioSource.input);
    
    source.start();
    state.sources.push(source);
    
    // Auto-stop after duration
    setTimeout(() => {
      try { source.stop(); } catch(e) {}
    }, buffer.duration * 1000);
  }
}

function stopPlayback() {
  state.sources.forEach(source => {
    if (source && source.stop) {
      try { source.stop(); } catch(e) {}
    }
  });
  state.sources = [];
  stopSpectrogram();
  state.isPlaying = false;
}

// ========================================
// ANSWER CHECKING
// ========================================

function checkAnswer(selected) {
  state.attempts++;
  
  if (selected === state.currentWord) {
    // Correct!
    showFeedback('success', 'Correct!');
    state.correct++;
    state.trials++;
    updateStats();
    
    // Highlight correct button
    const buttons = document.querySelectorAll('.choice-btn');
    buttons.forEach(btn => {
      if (btn.textContent.toLowerCase() === state.currentWord.toLowerCase()) {
        btn.classList.add('correct');
      }
      btn.disabled = true;
    });
    
    document.getElementById('btn-next').disabled = false;
    
  } else if (state.attempts < 2) {
    // First incorrect attempt - allow retry
    showFeedback('error', 'Try again');
    
    const buttons = document.querySelectorAll('.choice-btn');
    buttons.forEach(btn => {
      if (btn.textContent.toLowerCase() === selected.toLowerCase()) {
        btn.classList.add('incorrect');
        setTimeout(() => btn.classList.remove('incorrect'), 1000);
      }
    });
    
  } else {
    // Second incorrect attempt - reveal answer
    showFeedback('error', `The word was: ${state.currentWord}`);
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
// INITIALIZE ON LOAD
// ========================================

window.addEventListener('load', init);
