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
                    // Compile the function inside the worker thread
                    try {
                        this.byteFunc = new Function('t', data.helper + data.code);
                        this.mode = data.mode;
                        this.rate = data.rate;
                        this.vol = data.vol;
                        this.t = 0; // Reset time on compile
                    } catch (err) {
                        this.port.postMessage({ type: 'error', message: 'Compilation Error: ' + err.message });
                    }
                } else if (data.type === 'updateParams') {
                    this.mode = data.mode;
                    this.rate = data.rate;
                    this.vol = data.vol;
                }
            };
        }

        process(inputs, outputs, parameters) {
            const output = outputs[0];
            const channel = output[0];
            if (!channel) return true;

            if (!this.byteFunc) {
                channel.fill(0);
                return true;
            }

            const speed = this.rate / sampleRate;

            // Entire loop wrapped in a single try/catch to optimize performance and prevent message spamming
            try {
                for (let i = 0; i < channel.length; i++) {
                    let val = this.byteFunc(Math.floor(this.t));
                    
                    if (this.mode === 'float') {
                        val = val || 0;
                    } else if (this.mode === 'signed') {
                        val = (((val & 255) << 24) >> 24) / 128;
                    } else {
                        val = ((val & 255) / 128) - 1;
                    }

                    channel[i] = this.vol * val;
                    this.t += speed;
                }
            } catch(err) {
                this.port.postMessage({
                    type: "error",
                    message: "Runtime Error: " + (err.message || err.toString())
                });

                this.byteFunc = null; // Disable execution immediately
                channel.fill(0);      // Output clean silence
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
        const helper = styleSelect.value === 'simple' ? 
            `const int=Math.floor,
                   abs=Math.abs, acos=Math.acos, acosh=Math.acosh, asin=Math.asin, asinh=Math.asinh,
                   atan=Math.atan, atan2=Math.atan2, atanh=Math.atanh, cbrt=Math.cbrt, ceil=Math.ceil,
                   clz32=Math.clz32, cos=Math.cos, cosh=Math.cosh, exp=Math.exp, expm1=Math.expm1,
                   floor=Math.floor, fround=Math.fround, hypot=Math.hypot, imul=Math.imul, log=Math.log,
                   log10=Math.log10, log1p=Math.log1p, log2=Math.log2, max=Math.max, min=Math.min,
                   pow=Math.pow, random=Math.random, round=Math.round, sign=Math.sign, sin=Math.sin,
                   sinh=Math.sinh, sqrt=Math.sqrt, tan=Math.tan, tanh=Math.tanh, trunc=Math.trunc,
                   pi=Math.PI, PI=Math.PI;
             let a,b,c,d,e,f,g,h,i,j,k,l,m,n,o,p,q,r,s,u,v,w,x,y,z;` : '';
        
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
