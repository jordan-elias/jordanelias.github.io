// ========================================
// AUDIO ENGINE - COCKTAIL PARTY PROBLEM
// Handles Resonance Audio, timing, and SNR
// ========================================

class AudioEngine {
  constructor() {
    this.audioCtx = null;
    this.resonanceScene = null;
    this.analyser = null;
    this.sources = [];
    this.isInitialized = false;
  }

  async init() {
    if (this.isInitialized) return;
    
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    this.audioCtx = new AudioContext();
    
    // Initialize Resonance Audio
    this.resonanceScene = new ResonanceAudio(this.audioCtx);
    
    // Set room properties
    this.resonanceScene.setRoomProperties({
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
    
    // Create analyser for spectrogram
    this.analyser = this.audioCtx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = 0.8;
    
    // Connect: resonance -> analyser -> destination
    this.resonanceScene.output.connect(this.analyser);
    this.analyser.connect(this.audioCtx.destination);
    
    this.isInitialized = true;
  }

  resume() {
    if (this.audioCtx && this.audioCtx.state === 'suspended') {
      this.audioCtx.resume();
    }
  }

  // Calculate masker gain based on SNR (dB)
  // SNR = 20 * log10(target / masker)
  // maskerGain = 10^(-SNR/20)
  calculateMaskerGain(snr, targetGain = 1.0) {
    return targetGain * Math.pow(10, -snr / 20);
  }

  // Create a spatial source at specified position
  createSpatialSource(buffer, gain, position = null) {
    const source = this.audioCtx.createBufferSource();
    source.buffer = buffer;
    
    const audioSource = this.resonanceScene.createSource();
    
    // Position source (default: centered forward)
    if (position) {
      audioSource.setPosition(position.x, position.y, position.z);
    } else {
      audioSource.setPosition(0, 0, -1);
    }
    
    const gainNode = this.audioCtx.createGain();
    gainNode.gain.value = gain;
    
    source.connect(gainNode);
    gainNode.connect(audioSource.input);
    
    return source;
  }

  // Play a complete trial with precise timing
  playTrial(targetBuffer, maskerBuffers, settings) {
    this.stopAll();
    
    const startTime = this.audioCtx.currentTime;
    const duration = 4.0; // Fixed 4-second window
    
    // Schedule target word at random time between 0.5s and 2.5s
    const wordStartTime = startTime + 0.5 + (Math.random() * 2.0);
    
    // Spatial positions for maskers (azimuth angles in radians)
    const positions = [
      { x: -2, y: 0, z: 0 },      // Left (-90°)
      { x: -1.5, y: 0, z: -1.5 }, // Front-left (-45°)
      { x: 1.5, y: 0, z: -1.5 },  // Front-right (45°)
      { x: 0, y: 0, z: 2 }        // Behind (180°)
    ];
    
    // Start maskers at t=0
    maskerBuffers.forEach((buffer, index) => {
      if (!buffer) return;
      
      const position = positions[index] || positions[0];
      const source = this.createSpatialSource(buffer, settings.maskerGain, position);
      
      source.start(startTime);
      source.stop(startTime + duration);
      
      this.sources.push(source);
    });
    
    // Start target word at random offset
    const targetSource = this.createSpatialSource(
      targetBuffer, 
      settings.targetGain,
      { x: 0, y: 0, z: -1 } // Centered forward
    );
    
    targetSource.start(wordStartTime);
    targetSource.stop(startTime + duration);
    
    this.sources.push(targetSource);
    
    return duration;
  }

  stopAll() {
    this.sources.forEach(source => {
      try {
        source.stop();
      } catch (e) {
        // Already stopped
      }
    });
    this.sources = [];
  }

  getAnalyser() {
    return this.analyser;
  }
}

// ========================================
// ASSET LOADER
// Pre-loads audio files for zero-latency
// ========================================

class AssetLoader {
  constructor(audioCtx) {
    this.audioCtx = audioCtx;
    this.buffers = {
      targets: {},
      maskers: {}
    };
  }

  async loadAudio(url) {
    try {
      const response = await fetch(url);
      const arrayBuffer = await response.arrayBuffer();
      return await this.audioCtx.decodeAudioData(arrayBuffer);
    } catch (error) {
      console.warn(`Failed to load: ${url}`, error);
      return null;
    }
  }

  async loadTargetWord(word, variant = 0) {
    const url = `./audio/targets/${word}_${variant}.mp3`;
    const buffer = await this.loadAudio(url);
    
    if (!this.buffers.targets[word]) {
      this.buffers.targets[word] = [];
    }
    this.buffers.targets[word][variant] = buffer;
    
    return buffer;
  }

  async loadMasker(type) {
    const url = `./audio/maskers/${type}.mp3`;
    const buffer = await this.loadAudio(url);
    this.buffers.maskers[type] = buffer;
    return buffer;
  }

  // Get random excerpt from masker buffer
  getRandomExcerpt(buffer, duration = 4.0) {
    if (!buffer) return null;
    
    const sampleRate = this.audioCtx.sampleRate;
    const excerptLength = Math.floor(sampleRate * duration);
    const maxStart = buffer.length - excerptLength;
    
    if (maxStart <= 0) return buffer;
    
    const startSample = Math.floor(Math.random() * maxStart);
    
    const excerptBuffer = this.audioCtx.createBuffer(
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

  getTargetBuffer(word) {
    const variants = this.buffers.targets[word];
    if (!variants || variants.length === 0) return null;
    
    // Pick random variant
    const available = variants.filter(b => b !== null);
    if (available.length === 0) return null;
    
    return available[Math.floor(Math.random() * available.length)];
  }

  getMaskerBuffer(type) {
    return this.buffers.maskers[type] || null;
  }
}

// Export for use in main.js
window.AudioEngine = AudioEngine;
window.AssetLoader = AssetLoader;
