// ======================================================
// modules.js
// ======================================================

// ========================================
// AUDIO CONTEXT & RESONANCE AUDIO INIT
// ========================================

const AudioContext = window.AudioContext || window.webkitAudioContext;
let audioCtx;
let resonanceAudioScene;

function initAudio() {
    if (!audioCtx) {
        audioCtx = new AudioContext();
        resonanceAudioScene = new ResonanceAudio(audioCtx);
        resonanceAudioScene.output.connect(audioCtx.destination);
    }
    if (audioCtx.state === 'suspended') {
        audioCtx.resume();
    }
}

// ========================================
// AUDIO GENERATORS
// ========================================

function createPinkNoise() {
    const bufferSize = 2 * audioCtx.sampleRate;
    const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
    const output = buffer.getChannelData(0);

    let b0, b1, b2, b3, b4, b5, b6;
    b0 = b1 = b2 = b3 = b4 = b5 = b6 = 0.0;

    for (let i = 0; i < bufferSize; i++) {
        const white = Math.random() * 2 - 1;
        b0 = 0.99886 * b0 + white * 0.0555179;
        b1 = 0.99332 * b1 + white * 0.0750759;
        b2 = 0.96900 * b2 + white * 0.1538520;
        b3 = 0.86650 * b3 + white * 0.3104856;
        b4 = 0.55000 * b4 + white * 0.5329522;
        b5 = -0.7616 * b5 - white * 0.0168980;
        output[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362;
        output[i] *= 0.11; // scale
        b6 = white * 0.115926;
    }

    const node = audioCtx.createBufferSource();
    node.buffer = buffer;
    node.loop = true;
    return node;
}

function createSpeechShapedNoise() {
    // Placeholder for now — replace with actual implementation or load audio
    return createPinkNoise();
}

function createPartyBabble() {
    // Placeholder for now — replace with actual implementation or load audio
    return createPinkNoise();
}

// ========================================
// MODULE 1: WORD IDENTIFICATION
// ========================================

const m1 = {
    trials: 0,
    correct: 0,
    currentWord: null,
    choices: [],
    attempts: 0,
    source: null,
    maskerSources: [],
    isPlaying: false,
    wordSets: {
        colors: [
            'red', 'blue', 'green', 'yellow', 'orange', 'purple', 'pink', 'brown', 'black', 'white',
            'gray', 'silver', 'gold', 'violet', 'indigo', 'cyan', 'magenta', 'turquoise', 'lime', 'maroon'
        ],
        numbers: ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten']
    },
    difficulties: {
        easy: { snr: 10, maskerCount: 1, maskerType: 'pink', speed: 0.85 },
        medium: { snr: 0, maskerCount: 2, maskerType: 'speech', speed: 1.0 },
        hard: { snr: -5, maskerCount: 3, maskerType: 'party', speed: 1.0 }
    },
    maskerTypes: {
        pink: { name: 'Pink Noise', generator: createPinkNoise },
        speech: { name: 'Speech-Shaped Noise', generator: createSpeechShapedNoise },
        party: { name: 'Party Babble', generator: createPartyBabble },
        traffic: { name: 'Traffic Sounds', generator: createPinkNoise },
        nature: { name: 'Nature Sounds', generator: createPinkNoise }
    }
};

// ========================================
// MODULE 1 INITIALIZATION & PLAYBACK
// ========================================

function initModule1() {
    console.log('Module 1 initialized');
    // Example: set up your UI buttons and event listeners here
}

function playWord(word, difficulty = 'easy') {
    if (m1.isPlaying) return;
    m1.isPlaying = true;

    initAudio();

    // Example: create main word source (placeholder using pink noise)
    m1.source = createPinkNoise();
    m1.source.connect(audioCtx.destination);
    m1.source.start();

    // Add masker sources based on difficulty
    const maskerCount = m1.difficulties[difficulty].maskerCount;
    for (let i = 0; i < maskerCount; i++) {
        const maskerType = m1.difficulties[difficulty].maskerType;
        const masker = m1.maskerTypes[maskerType].generator();
        masker.connect(audioCtx.destination);
        masker.start();
        m1.maskerSources.push(masker);
    }

    setTimeout(() => stopWord(), 3000); // auto stop after 3 sec for demo
}

function stopWord() {
    if (m1.source) {
        m1.source.stop();
        m1.source.disconnect();
        m1.source = null;
    }
    m1.maskerSources.forEach(ms => {
        ms.stop();
        ms.disconnect();
    });
    m1.maskerSources = [];
    m1.isPlaying = false;
}

// ========================================
// DOM READY INITIALIZATION
// ========================================

window.addEventListener('DOMContentLoaded', () => {
    initAudio();
    initModule1();
    console.log('Modules.js loaded and audio initialized');
});
