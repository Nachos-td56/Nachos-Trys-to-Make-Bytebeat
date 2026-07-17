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

// Define the AudioWorklet Processor source code in a string
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
                }
            };
        }

        process(inputs, outputs, parameters) {
            const output = outputs[0];
            const ch0 = output[0];
            const ch1 = output[1] || output[0]; // Channel 1 falls back to 0 if mono target
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
                    
                    // Support stereo returning arrays: [left, right]
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
    // Define custom green retro theme
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

    // Initialize the editor inside our div
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

// Live parameter updates (rate, volume, mode) without stopping audio
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
            
            // Create an object URL from the worklet code string and load it
            const blob = new Blob([workletCode], { type: 'application/javascript' });
            const url = URL.createObjectURL(blob);
            await audioCtx.audioWorklet.addModule(url);
            
            analyser = audioCtx.createAnalyser();
            analyser.fftSize = 2048;
        }
        await audioCtx.resume();

        // Setup the worklet node
        workletNode = new AudioWorkletNode(audioCtx, 'bytebeat-processor');
        
        // Handle compilation & runtime error feedback back from the worker thread
        workletNode.port.onmessage = (e) => {
            if (e.data.type === 'error') {
                log(e.data.message);
            }
        };

        // Prepare user code
        let code = editor.getValue().trim();

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
            let a,b,c,d,e,f,g,h,i,j,k,l,m,n,o,p,q,r,s,u,v,w,x,y,z;
        `;

        const helper = styleSelect.value === 'simple' ? memoryHelper + mathHelper : memoryHelper;
        
        const finalCode = styleSelect.value === 'complex' ? code + ';return out||val||0;' : 'return ' + code + ';';

        // Send setup details to the processor running on the separate thread
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

async function exportWAV(durationSec = 10) {
    log(`Rendering ${durationSec}s WAV file...`);
    
    const targetRate = parseFloat(rateInput.value) || 44100;
    const sampleCount = Math.floor(targetRate * durationSec);
    const offlineCtx = new OfflineAudioContext(2, sampleCount, targetRate);
    
    // Evaluate function offline
    const userCode = editor.getValue().trim();
    const finalCode = styleSelect.value === 'complex' ? userCode + ';return out||val||0;' : 'return ' + userCode + ';';
    const evalFunc = new Function('t', helper + finalCode);
    
    const leftBuffer = offlineCtx.createBuffer(2, sampleCount, targetRate).getChannelData(0);
    const rightBuffer = offlineCtx.createBuffer(2, sampleCount, targetRate).getChannelData(1);
    
    const mode = modeSelect.value;
    const vol = +volInput.value;

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

    // Convert float samples to 16-bit PCM WAV File
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
    const bufferLength = left.length * blockAlign;
    const headerByteLength = 44;
    const arrayBuffer = new ArrayBuffer(headerByteLength + bufferLength);
    const view = new DataView(arrayBuffer);

    const writeString = (offset, str) => {
        for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
    };

    /* RIFF header */
    writeString(0, 'RIFF');
    view.setUint32(4, 36 + bufferLength, true);
    writeString(8, 'WAVE');
    /* FMT chunk */
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); // PCM format
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * blockAlign, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, 16, true); // Bits per sample
    /* DATA chunk */
    writeString(36, 'data');
    view.setUint32(40, bufferLength, true);

    // Write interleaved samples
    let offset = 44;
    for (let i = 0; i < left.length; i++) {
        let sL = Math.max(-1, Math.min(1, left[i]));
        let sR = Math.max(-1, Math.min(1, right[i]));
        view.setInt16(offset, sL < 0 ? sL * 0x8000 : sL * 0x7FFF, true);
        view.setInt16(offset + 2, sR < 0 ? sR * 0x8000 : sR * 0x7FFF, true);
        offset += 4;
    }

    return new Blob([arrayBuffer], { type: 'audio/wav' });
}

document.getElementById('export-wav').onclick = () => exportWAV(10); // Exports 10 seconds
