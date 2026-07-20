let audioCtx, workletNode, analyser, animationFrame;
let isPlaying = false;
let editor; // Global Monaco instance
const logEl = document.getElementById('log');

function log(msg) { logEl.textContent = msg; console.log(msg); }

const canvas = document.getElementById('viz');
const ctx = canvas.getContext('2d');
const modeSelect = document.getElementById('mode');
const styleSelect = document.getElementById('style');
const rateInput = document.getElementById('rate');
const volInput = document.getElementById('vol');

// === MOVED TO GLOBAL SCOPE ===
// Stateful Memory, Bytebeat Math & Clamping Helpers
const memoryHelper = `
    if (!globalThis._bbState) {
        globalThis._bbState = {
            sample: new Float32Array(65536),
            auxiliary: new Float32Array(65536),
            waveform: new Float32Array(65536),
            mem: {}
        };
    }

    const sampleMemory = globalThis._bbState.sample,
       auxiliaryMemory = globalThis._bbState.auxiliary,
       waveformMemory = globalThis._bbState.waveform,
       customMemory = globalThis._bbState.mem;

   const clamp = (v, min = -1, max = 1) => Math.min(Math.max(v, min), max);
   const wrap = (v, min = 0, max = 255) => {
       const r = max - min + 1;
       return ((v - min) % r + r) % r + min;
   };
   const lerp = (v0, v1, amt) => v0 + amt * (v1 - v0);
`;

const mathHelper = `
    const int=Math.floor, abs=Math.abs, acos=Math.acos, acosh=Math.acosh, asin=Math.asin, asinh=Math.asinh,
          atan=Math.atan, atan2=Math.atan2, atanh=Math.atanh, cbrt=Math.cbrt, ceil=Math.ceil,
          clz32=Math.clz32, cos=Math.cos, cosh=Math.cosh, exp=Math.exp, expm1=Math.expm1,
          floor=Math.floor, fround=Math.fround, hypot=Math.hypot, imul=Math.imul, log=Math.log,
          log10=Math.log10, log1p=Math.log1p, log2=Math.log2, max=Math.max, min=Math.min,
          pow=Math.pow, random=Math.random, round=Math.round, sign=Math.sign, sin=Math.sin,
          sinh=Math.sinh, sqrt=Math.sqrt, tan=Math.tan, tanh=Math.tanh, trunc=Math.trunc,
          pi=Math.PI, PI=Math.PI;
    let a,b,c,d,e,f,g,h,i,j,k,l,m,n,o,p,q,r,s,u,v,w,x,y,z,A,B,C,D,E,F,G,H,I,J,K,L,M,N,O,P,Q,R,S,T,U,V,W,X,Y,Z;
`;

// Define the AudioWorklet Processor source code in a string, may move this to its own .js file
const workletCode = `
    class BytebeatProcessor extends AudioWorkletProcessor {
        constructor() {
            super();
            this.t = 0;
            this.byteFunc = null;
            this.mode = 'byte';
            this.rate = 48000;
            this.vol = 0.85;

            this.port.onmessage = (e) => {
                const data = e.data;
                if (data.type === 'init') {
                    try {
                        this.byteFunc = new Function('t', data.helper + data.code);
                        this.mode = data.mode;
                        this.rate = data.rate;
                        this.vol = data.vol;
                        this.t = 0;
                    } catch (err) {
                        this.port.postMessage({ type: 'error', message: 'Compilation Error: ' + err.message });
                    }
                } else if (data.type === 'updateParams') {
                    this.mode = data.mode;
                    this.rate = data.rate;
                    this.vol = data.vol;
                } else if (data.type === 'resetTime') {
                    this.t = 0;
                } else if (data.type === 'resetState') {
                    if (globalThis._bbState) {
                        globalThis._bbState.sample.fill(0);
                        globalThis._bbState.auxiliary.fill(0);
                        globalThis._bbState.waveform.fill(0);
                        globalThis._bbState.mem = {};
                    }
                    this.t = 0;
                    this.port.postMessage({ type: 'stateReset' }); // optional feedback
                }
            };
        }

        process(inputs, outputs, parameters) {
            const output = outputs[0];
            const ch0 = output[0];
            const ch1 = output[1] || output[0];
            if (!ch0) return true;

            if (!this.byteFunc) {
                ch0.fill(0);
                if (output[1]) output[1].fill(0);
                return true;
            }

            const speed = this.rate / sampleRate;

            try {
                for (let i = 0; i < ch0.length; i++) {
                    let rawVal = this.byteFunc(Math.floor(this.t));
                    
                    let lVal = Array.isArray(rawVal) ? rawVal[0] : rawVal;
                    let rVal = Array.isArray(rawVal) ? rawVal[1] : rawVal;

                    const normalize = (val) => {
                        if (this.mode === 'float') return val || 0;
                        if (this.mode === 'signed') return (((val & 255) << 24) >> 24) / 128;
                        return ((val & 255) / 128) - 1;
                    };

                    ch0[i] = this.vol * normalize(lVal);
                    if (output[1]) ch1[i] = this.vol * normalize(rVal);

                    this.t += speed;
                }
            } catch(err) {
                this.port.postMessage({
                    type: "error",
                    message: "Runtime Error: " + (err.message || err.toString())
                });
                this.byteFunc = null;
                ch0.fill(0);
                if (output[1]) output[1].fill(0);
            }
            return true;
        }
    }
    registerProcessor('bytebeat-processor', BytebeatProcessor);
`;

// Configure and Load Monaco Editor
require.config({ paths: { 'vs': 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.48.0/min/vs' }});
require(['vs/editor/editor.main'], function() {
    monaco.editor.defineTheme('bytebeat-theme', {
        base: 'vs-dark',
        inherit: true,
        rules: [
            { token: '', foreground: '00ff00' },
            { token: 'keyword', foreground: 'ffffff', fontStyle: 'bold' },
            { token: 'number', foreground: 'ffff00' },
            { token: 'comment', foreground: '006600', fontStyle: 'italic' }
        ],
        colors: {
            'editor.background': '#222222',
            'editor.foreground': '#00ff00',
            'editorLineNumber.foreground': '#005500',
            'editorLineNumber.activeForeground': '#00ff00',
            'editor.lineHighlightBackground': '#1a331a',
        }
    });

    editor = monaco.editor.create(document.getElementById('editor'), {
        value: `((4E4/(t&2**13-1)*'1001101110011010'[15&t>>13]&128)+(t*sin(t>>2)*'00100011'[7&t>>14]&128)%256*(-t&2**14-1)/2E4+(t*[1,1.2,1.35,1.5][3&t>>16]>>2&128)+(t/16*'8867'[3&t>>15]*'1232'[3&t>>13]&128))/1.5 \n// bytebeat from https://www.reddit.com/r/bytebeat/comments/14je5fs/frodo_and_the_magic_weed`,
        language: 'javascript',
        theme: 'bytebeat-theme',
        minimap: { enabled: false },
        lineNumbers: 'on',
        automaticLayout: true,
        fontSize: 14,
        fontFamily: 'monospace'
    });

    log("Ready...");
});

function drawVisualizer() {
    if (!analyser) return;
    const data = new Uint8Array(analyser.fftSize);
    analyser.getByteTimeDomainData(data);
    ctx.fillStyle = '#000'; ctx.fillRect(0,0,canvas.width,canvas.height);
    ctx.lineWidth = 3; ctx.strokeStyle = '#0f0'; ctx.shadowBlur = 10; ctx.shadowColor = '#0f0';
    ctx.beginPath();
    const slice = canvas.width / data.length;
    let x = 0;
    for (let i = 0; i < data.length; i++) {
        const y = (data[i] / 128) * canvas.height / 2;
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        x += slice;
    }
    ctx.stroke();
    animationFrame = requestAnimationFrame(drawVisualizer);
}

function updateRuntimeParams() {
    if (workletNode) {
        workletNode.port.postMessage({
            type: 'updateParams',
            mode: modeSelect.value,
            rate: parseFloat(rateInput.value) || 44100,
            vol: +volInput.value
        });
    }
}

rateInput.oninput = updateRuntimeParams;
volInput.oninput = updateRuntimeParams;
modeSelect.onchange = updateRuntimeParams;

document.getElementById('play').onclick = async () => {
    if (isPlaying) return;
    if (!editor) {
        log("Wait for Monaco Editor to finish loading...");
        return;
    }
    
    try {
        if (!audioCtx) {
            audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            const blob = new Blob([workletCode], { type: 'application/javascript' });
            const url = URL.createObjectURL(blob);
            await audioCtx.audioWorklet.addModule(url);
            
            analyser = audioCtx.createAnalyser();
            analyser.fftSize = 2048;
        }
        await audioCtx.resume();

        workletNode = new AudioWorkletNode(audioCtx, 'bytebeat-processor');
        
        workletNode.port.onmessage = (e) => {
            if (e.data.type === 'error') log(e.data.message);
        };

        let code = editor.getValue().trim();

        // Local helper generation using now-global variables
        const helper = styleSelect.value === 'simple' ? memoryHelper + mathHelper : memoryHelper;
        const finalCode = styleSelect.value === 'complex' ? code + ';return out||val||0;' : 'return ' + code + ';';

        // Reset state so if a old song was played, it doesnt pollute the new songs state
        workletNode.port.postMessage({ type: 'resetState' });

        workletNode.port.postMessage({
            type: 'init',
            helper: helper,
            code: finalCode,
            mode: modeSelect.value,
            rate: parseFloat(rateInput.value) || 44100,
            vol: +volInput.value
        });

        workletNode.connect(analyser);
        analyser.connect(audioCtx.destination);
        
        isPlaying = true;
        log("Loaded OK");
        drawVisualizer();
    } catch (err) {
        log("Initialization Error: " + err.message);
    }
};

document.getElementById('stop').onclick = () => {
    if (workletNode) {
        workletNode.disconnect();
        workletNode = null;
    }
    if (animationFrame) cancelAnimationFrame(animationFrame);
    isPlaying = false;
    ctx.fillStyle = '#000'; ctx.fillRect(0,0,canvas.width,canvas.height);
    log("Stopped");
};

document.getElementById('reset-time').onclick = () => {
    if (workletNode) workletNode.port.postMessage({ type: 'resetTime' });
};

function detectLoopPeriod(evalFunc) {
    // Large loop periods to check (powers of 2 up to ~16.7 million samples / 6 minutes at 44.1kHz)
    const candidates = [];
    for (let power = 12; power <= 24; power++) {
        candidates.push(Math.pow(2, power));
    }
    
    // Evaluates a test point. Handles both stereophonic arrays and monophonic numbers.
    const getOutputsEqual = (t1, t2) => {
        const val1 = evalFunc(t1);
        const val2 = evalFunc(t2);
        if (Array.isArray(val1) && Array.isArray(val2)) {
            return val1[0] === val2[0] && val1[1] === val2[1];
        }
        return val1 === val2;
    };

    // We must check a wide spread of "probe times" to ensure we aren't tricked 
    // by small repeating waveforms in the intro or a single silent bar.
    const probePoints = [0, 100, 1000, 8192, 16384, 65536, 131072, 262144];

    for (const P of candidates) {
        let isTruePeriod = true;
        for (const t of probePoints) {
            if (!getOutputsEqual(t, t + P)) {
                isTruePeriod = false;
                break;
            }
        }
        if (isTruePeriod) {
            // Once a math loop period matches, double-check deep in the timeline to confirm
            let doubleCheck = true;
            for (let offset = 1; offset <= 100; offset++) {
                if (!getOutputsEqual(t + P * 2 + offset, t + P * 3 + offset)) {
                    doubleCheck = false;
                    break;
                }
            }
            if (doubleCheck) {
                return P; // True seamless loop period found!
            }
        }
    }
    
    // Fallback if the song has no loop structure or contains random()
    return 262144; 
}

async function exportWAV(requestedDurationSec = 20) {
    const targetRate = parseFloat(rateInput.value) || 44100;
    
    const userCode = editor.getValue().trim();
    const finalCode = styleSelect.value === 'complex' ? userCode + ';return out||val||0;' : 'return ' + userCode + ';';
    
    const helper = styleSelect.value === 'simple' ? memoryHelper + mathHelper : memoryHelper;
    const evalFunc = new Function('t', `
        if (!globalThis._bbState) {
            globalThis._bbState = {
                sample: new Float32Array(65536),
                auxiliary: new Float32Array(65536),
                waveform: new Float32Array(65536),
                mem: {}
            };
        } else {
            globalThis._bbState.sample.fill(0);
            globalThis._bbState.auxiliary.fill(0);
            globalThis._bbState.waveform.fill(0);
            globalThis._bbState.mem = {};
        }
        ` + helper + finalCode); // Reset state here also
    
    // Run our "robust" macro loop-detector
    const loopCycleSamples = detectLoopPeriod(evalFunc);
    log(`Detected true song loop period: ${loopCycleSamples} steps.`);
    
    // Determine how many samples the user requested
    const requestedSamples = Math.floor(targetRate * requestedDurationSec);
    
    // Round to the nearest complete MACRO cycle
    const cyclesCount = Math.max(1, Math.round(requestedSamples / loopCycleSamples));
    const sampleCount = cyclesCount * loopCycleSamples;
    const actualDurationSec = sampleCount / targetRate;
    
    log(`Exporting ${cyclesCount} complete seamless cycle(s). File length: ${actualDurationSec.toFixed(2)}s.`);
    
    const offlineCtx = new OfflineAudioContext(2, sampleCount, targetRate);
    
    const leftBuffer = offlineCtx.createBuffer(2, sampleCount, targetRate).getChannelData(0);
    const rightBuffer = offlineCtx.createBuffer(2, sampleCount, targetRate).getChannelData(1);
    
    const mode = modeSelect.value;
    const vol = +volInput.value;

    // Render the audio
    for (let t = 0; t < sampleCount; t++) {
        let rawVal = evalFunc(t);
        let lVal = Array.isArray(rawVal) ? rawVal[0] : rawVal;
        let rVal = Array.isArray(rawVal) ? rawVal[1] : rawVal;

        const norm = (v) => {
            if (mode === 'float') return v || 0;
            if (mode === 'signed') return (((v & 255) << 24) >> 24) / 128;
            return ((v & 255) / 128) - 1;
        };

        leftBuffer[t] = vol * norm(lVal);
        rightBuffer[t] = vol * norm(rVal);
    }

    const wavBlob = bufferToWavBlob(leftBuffer, rightBuffer, targetRate);
    const downloadUrl = URL.createObjectURL(wavBlob);
    
    const a = document.createElement('a');
    a.href = downloadUrl;
    a.download = `bytebeat_${Date.now()}.wav`;
    a.click();
    log("WAV Download started!");
}

function bufferToWavBlob(left, right, sampleRate) {
    const numChannels = 2;
    const bytesPerSample = 2;
    const blockAlign = numChannels * bytesPerSample;
    const audioDataLength = left.length * blockAlign;
    
    // Exact sizes for our structured chunks
    const fmtChunkSize = 16;  // Standard PCM fmt chunk size
    const smplChunkSize = 68; // 8 bytes (ID + Size) + 60 bytes of payload (36 metadata + 24 loop)
    
    // Header structure size:
    // - 12 bytes: "RIFF" (4) + File Size (4) + "WAVE" (4)
    // - 8 bytes:  "fmt " ID (4) + chunk size (4)
    // - 16 bytes: fmt chunk payload
    // - 8 bytes:  "smpl" ID (4) + chunk size (4)
    // - 60 bytes: smpl chunk payload (36 sampler metadata + 24 loop info)
    // - 8 bytes:  "data" ID (4) + chunk size (4)
    const totalHeaderLength = 12 + (8 + fmtChunkSize) + (8 + (smplChunkSize - 8)) + 8;
    
    // Allocate the exact size needed (header space + raw audio block size)
    const arrayBuffer = new ArrayBuffer(totalHeaderLength + audioDataLength);
    const view = new DataView(arrayBuffer);

    const writeString = (offset, str) => {
        for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
    };

    let offset = 0;

    /* RIFF Header */
    writeString(offset, 'RIFF');
    // Total file size after this field (total header bytes minus 8 + audio data)
    view.setUint32(offset + 4, (totalHeaderLength - 8) + audioDataLength, true);
    writeString(offset + 8, 'WAVE');
    offset += 12;
    
    /* FMT Chunk */
    writeString(offset, 'fmt ');
    view.setUint32(offset + 4, fmtChunkSize, true);
    view.setUint16(offset + 8, 1, true); // PCM format
    view.setUint16(offset + 10, numChannels, true);
    view.setUint32(offset + 12, sampleRate, true);
    view.setUint32(offset + 16, sampleRate * blockAlign, true);
    view.setUint16(offset + 20, blockAlign, true);
    view.setUint16(offset + 22, 16, true); // 16 bits per sample
    offset += 8 + fmtChunkSize;
    
    /* SMPL (Loop) Chunk */
    writeString(offset, 'smpl');                         // Chunk ID (4 bytes)
    view.setUint32(offset + 4, smplChunkSize - 8, true); // Chunk payload size (60 bytes)
    view.setUint32(offset + 8, 0, true);                 // Manufacturer (0 = generic)
    view.setUint32(offset + 12, 0, true);                // Product (0 = generic)
    view.setUint32(offset + 16, Math.round(1000000000 / sampleRate), true); // Sample Period in nanoseconds
    view.setUint32(offset + 20, 60, true);               // MIDI Unity Note (60 = Middle C)
    view.setUint32(offset + 24, 0, true);                // MIDI Pitch Fraction
    view.setUint32(offset + 28, 0, true);                // SMPTE Format
    view.setUint32(offset + 32, 0, true);                // SMPTE Offset
    view.setUint32(offset + 36, 1, true);                // Sample Loops Count (1 loop)
    view.setUint32(offset + 40, 0, true);                // Sampler Specific Data size

    // Loop definition inside 'smpl' (starts at offset + 44)
    view.setUint32(offset + 44, 0, true);                // Cue Point ID
    view.setUint32(offset + 48, 0, true);                // Type (0 = Normal forward loop)
    view.setUint32(offset + 52, 0, true);                // Start sample index
    view.setUint32(offset + 56, left.length - 1, true);  // End sample index (Loop endpoint)
    view.setUint32(offset + 60, 0, true);                // Fractional pitch
    view.setUint32(offset + 64, 0, true);                // Play Count (0 = Infinite loop)
    
    // Jump past the entire smpl chunk (8 bytes of header + 60 bytes of payload)
    offset += smplChunkSize;

    /* DATA Chunk Header */
    writeString(offset, 'data');
    view.setUint32(offset + 4, audioDataLength, true);
    offset += 8;

    /* Write interleaved 16-bit audio samples */
    for (let i = 0; i < left.length; i++) {
        let sL = Math.max(-1, Math.min(1, left[i]));
        let sR = Math.max(-1, Math.min(1, right[i]));
        
        // Convert floats (-1.0 to 1.0) to 16-bit signed integers
        view.setInt16(offset, sL < 0 ? sL * 0x8000 : sL * 0x7FFF, true);
        view.setInt16(offset + 2, sR < 0 ? sR * 0x8000 : sR * 0x7FFF, true);
        offset += 4;
    }

    return new Blob([arrayBuffer], { type: 'audio/wav' });
}

document.getElementById('export-wav').onclick = () => exportWAV(20);
