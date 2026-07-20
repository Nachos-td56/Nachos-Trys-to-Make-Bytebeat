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

                // Nuke common custom globals if any
                ['fx','fxi','out','h','A','c1','c2','c3'].forEach(k => delete globalThis[k]);

                this.t = 0;
                this.port.postMessage({ type: 'stateReset' });
            }
        };
    }

    process(inputs, outputs, parameters) {
        const output = outputs[0];
        if (!output || output.length < 2) return true; // safety

        const ch0 = output[0];
        const ch1 = output[1];

        if (!ch0 || !this.byteFunc) {
            ch0?.fill(0);
            ch1?.fill(0);
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
                ch1[i] = this.vol * normalize(rVal);

                this.t += speed;
            }
        } catch(err) {
            this.port.postMessage({
                type: "error",
                message: "Runtime Error: " + (err.message || err.toString())
            });
            this.byteFunc = null;
            ch0.fill(0);
            ch1.fill(0);
        }
        return true;
    }
}

registerProcessor('bytebeat-processor', BytebeatProcessor);
