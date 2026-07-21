let audioCtx, workletNode, analyser, animationFrame;
let isPlaying = false;
let editor; // Global Monaco instance
const logEl = document.getElementById('log');

function log(msg) { logEl.textContent = msg; console.log(msg); }

const canvas = document.getElementById('viz');
const ctx = canvas.getContext('2d');
const modeSelect = document.getElementById('mode');
const rateInput = document.getElementById('rate');
const volInput = document.getElementById('vol');

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

const workletUrl = 'bytebeat-processor.js';

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
            await audioCtx.audioWorklet.addModule(workletUrl);
            analyser = audioCtx.createAnalyser();
            analyser.fftSize = 2048;
        }
        
        await audioCtx.resume();

        if (workletNode) {
            workletNode.port.postMessage({ type: 'kill' });
            workletNode.disconnect();
            workletNode = null;
        }

        workletNode = new AudioWorkletNode(audioCtx, 'bytebeat-processor', {
            numberOfOutputs: 1,
            outputChannelCount: [2],
            channelCount: 2,
            channelCountMode: 'explicit'
        });
        
        workletNode.port.onmessage = (e) => {
            if (e.data.type === 'error') log(e.data.message);
        };

        let code = editor.getValue().trim();
        const mode = modeSelect.value;
        const helper = memoryHelper + mathHelper; // Math variables globally available

        let finalCode;
        if (mode === 'funcbeat') {
            finalCode = `
                const __init = () => {
                    ${code}
                };
                const __step = __init();
                return (typeof __step === 'function') ? __step(t) : (__step || 0);
            `;
        } else {
            finalCode = 'return ' + code + ';';
        }

        await new Promise((resolve) => {
            const handler = (e) => {
                if (e.data.type === "stateReset") {
                    workletNode.port.removeEventListener("message", handler);
                    resolve();
                }
            };

            workletNode.port.addEventListener("message", handler);
            workletNode.port.start();

            workletNode.port.postMessage({
                type: "resetState"
            });
        });

        workletNode.port.postMessage({
            type: "init",
            helper: helper,
            code: finalCode,
            mode: mode,
            rate: parseFloat(rateInput.value) || 44100,
            vol: +volInput.value
        });

        workletNode.connect(analyser);
        analyser.connect(audioCtx.destination);

        if (audioCtx.destination.channelCount !== 2) {
            audioCtx.destination.channelCount = 2;
            audioCtx.destination.channelCountMode = 'explicit';
        }
        
        isPlaying = true;
        log("Loaded");
        drawVisualizer();
    } catch (err) {
        log("Initialization Error: " + err.message);
    }
};

document.getElementById('stop').onclick = () => {
    if (workletNode) {
        workletNode.port.postMessage({ type: "resetState" });
        workletNode.port.postMessage({ type: 'kill' });

        workletNode.disconnect();
        workletNode = null;
    }

    if (animationFrame)
        cancelAnimationFrame(animationFrame);

    isPlaying = false;
    ctx.clearRect(0,0,canvas.width,canvas.height);
    log("Stopped");
};

document.getElementById('reset-time').onclick = () => {
    if (workletNode) workletNode.port.postMessage({ type: 'resetTime' });
};

function detectLoopPeriod(evalFunc) {
    const candidates = [];
    for (let power = 12; power <= 24; power++) {
        candidates.push(Math.pow(2, power));
    }
    
    const getOutputsEqual = (t1, t2) => {
        const val1 = evalFunc(t1);
        const val2 = evalFunc(t2);
        if (Array.isArray(val1) && Array.isArray(val2)) {
            return val1[0] === val2[0] && val1[1] === val2[1];
        }
        return val1 === val2;
    };

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
            let doubleCheck = true;
            for (let offset = 1; offset <= 100; offset++) {
                if (!getOutputsEqual(t + P * 2 + offset, t + P * 3 + offset)) {
                    doubleCheck = false;
                    break;
                }
            }
            if (doubleCheck) {
                return P;
            }
        }
    }
    return 262144; 
}

async function exportWAV(requestedDurationSec = 20) {
    const targetRate = parseFloat(rateInput.value) || 44100;
    const userCode = editor.getValue().trim();
    const mode = modeSelect.value;
    const helper = memoryHelper + mathHelper;

    let finalCode;
    if (mode === 'funcbeat') {
        finalCode = `
            const __init = () => {
                ${userCode}
            };
            const __step = __init();
            return (typeof __step === 'function') ? __step(t) : (__step || 0);
        `;
    } else {
        finalCode = 'return ' + userCode + ';';
    }
    
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
        ` + helper + finalCode);
    
    const loopCycleSamples = detectLoopPeriod(evalFunc);
    log(`Detected true song loop period: ${loopCycleSamples} steps.`);
    
    const requestedSamples = Math.floor(targetRate * requestedDurationSec);
    const cyclesCount = Math.max(1, Math.round(requestedSamples / loopCycleSamples));
    const sampleCount = cyclesCount * loopCycleSamples;
    const actualDurationSec = sampleCount / targetRate;
    
    log(`Exporting ${cyclesCount} complete seamless cycle(s). File length: ${actualDurationSec.toFixed(2)}s.`);
    
    const offlineCtx = new OfflineAudioContext(2, sampleCount, targetRate);
    const leftBuffer = offlineCtx.createBuffer(2, sampleCount, targetRate).getChannelData(0);
    const rightBuffer = offlineCtx.createBuffer(2, sampleCount, targetRate).getChannelData(1);
    const vol = +volInput.value;

    for (let t = 0; t < sampleCount; t++) {
        let currentT = (mode === 'float' || mode === 'funcbeat') ? (t / targetRate) : t;
        let rawVal = evalFunc(currentT);
        let lVal = Array.isArray(rawVal) ? rawVal[0] : rawVal;
        let rVal = Array.isArray(rawVal) ? rawVal[1] : rawVal;

        const norm = (v) => {
            if (mode === 'float' || mode === 'funcbeat') return v || 0;
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
    
    const fmtChunkSize = 16;
    const smplChunkSize = 68;
    const totalHeaderLength = 12 + (8 + fmtChunkSize) + (8 + (smplChunkSize - 8)) + 8;
    
    const arrayBuffer = new ArrayBuffer(totalHeaderLength + audioDataLength);
    const view = new DataView(arrayBuffer);

    const writeString = (offset, str) => {
        for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
    };

    let offset = 0;

    /* RIFF Header */
    writeString(offset, 'RIFF');
    view.setUint32(offset + 4, (totalHeaderLength - 8) + audioDataLength, true);
    writeString(offset + 8, 'WAVE');
    offset += 12;
    
    /* FMT Chunk */
    writeString(offset, 'fmt ');
    view.setUint32(offset + 4, fmtChunkSize, true);
    view.setUint16(offset + 8, 1, true);
    view.setUint16(offset + 10, numChannels, true);
    view.setUint32(offset + 12, sampleRate, true);
    view.setUint32(offset + 16, sampleRate * blockAlign, true);
    view.setUint16(offset + 20, blockAlign, true);
    view.setUint16(offset + 22, 16, true);
    offset += 8 + fmtChunkSize;
    
    /* SMPL Chunk */
    writeString(offset, 'smpl');
    view.setUint32(offset + 4, smplChunkSize - 8, true);
    view.setUint32(offset + 8, 0, true);
    view.setUint32(offset + 12, 0, true);
    view.setUint32(offset + 16, Math.round(1000000000 / sampleRate), true);
    view.setUint32(offset + 20, 60, true);
    view.setUint32(offset + 24, 0, true);
    view.setUint32(offset + 28, 0, true);
    view.setUint32(offset + 32, 0, true);
    view.setUint32(offset + 36, 1, true);
    view.setUint32(offset + 40, 0, true);

    view.setUint32(offset + 44, 0, true);
    view.setUint32(offset + 48, 0, true);
    view.setUint32(offset + 52, 0, true);
    view.setUint32(offset + 56, left.length - 1, true);
    view.setUint32(offset + 60, 0, true);
    view.setUint32(offset + 64, 0, true);
    
    offset += smplChunkSize;

    /* DATA Chunk Header */
    writeString(offset, 'data');
    view.setUint32(offset + 4, audioDataLength, true);
    offset += 8;

    for (let i = 0; i < left.length; i++) {
        let sL = Math.max(-1, Math.min(1, left[i]));
        let sR = Math.max(-1, Math.min(1, right[i]));
        
        view.setInt16(offset, sL < 0 ? sL * 0x8000 : sL * 0x7FFF, true);
        view.setInt16(offset + 2, sR < 0 ? sR * 0x8000 : sR * 0x7FFF, true);
        offset += 4;
    }

    return new Blob([arrayBuffer], { type: 'audio/wav' });
}

document.getElementById('export-wav').onclick = () => exportWAV(20);
