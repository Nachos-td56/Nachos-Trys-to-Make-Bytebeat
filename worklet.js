class BytebeatProcessor extends AudioWorkletProcessor {
  constructor() {
    super();

    this.t = 0;
    this.step = 1;

    this.fn = (t) => t;

    this.env = {
      ec: new Array(12288).fill(0),
      A: [],
      n: 12288,
      random: Math.random,
      sin: Math.sin,
      cos: Math.cos,
      tan: Math.tan,
      abs: Math.abs
    };

    this.port.onmessage = (e) => {
      if (e.data.type === "reset") {
        this.t = 0;
        this.env.ec.fill(0);
        return;
      }

      if (e.data.type === "code") {
        this.step = (e.data.rate || 8000) / sampleRate;

        // SAFE compile (no `with`, no script mode hacks)
        this.fn = new Function("t", "env", `
          const { ec, A, n, random, sin, cos, tan, abs } = env;

          return (${e.data.code});
        `);
      }
    };
  }

  process(_, outputs) {
    const outL = outputs[0][0];
    const outR = outputs[0][1] || outL;

    for (let i = 0; i < outL.length; i++) {
      let v = 0;

      try {
        v = this.fn(this.t, this.env);
      } catch {
        v = 0;
      }

      const l = v;
      const r = v;

      outL[i] = l;
      outR[i] = r;

      this.t += this.step;
    }

    return true;
  }
}

registerProcessor("bytebeat", BytebeatProcessor);
