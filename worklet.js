class BytebeatProcessor extends AudioWorkletProcessor {
  constructor() {
    super();

    this.t = 0;
    this.step = 1;

    // GLOBAL SCRIPT ENVIRONMENT (i stg if this doesnt fix it)
    this.env = {
      ec: new Array(12288).fill(0),
      A: [],
      n: 12288,
      random: Math.random,
      sin: Math.sin,
      cos: Math.cos,
      tan: Math.tan,
      abs: Math.abs,
      floor: Math.floor
    };

    this.runner = () => 0;

    this.port.onmessage = (e) => {
      if (e.data.reset) {
        this.t = 0;
        this.env.ec.fill(0);
        return;
      }

      if (e.data.rate) {
        this.step = e.data.rate / sampleRate;
      }

      if (e.data.code) {
        this.compile(e.data.code);
      }
    };
  }

  compile(code) {
    // THIS is now SCRIPT MODE execution
    try {
      const fn = new Function("env", `
        const { ec, A, n, random, sin, cos, tan, abs, floor } = env;

        return function(t) {
          ${code}
          return 0;
        };
      `);

      this.runner = fn(this.env);
    } catch (e) {
      this.runner = () => 0;
    }
  }

  process(_, outputs) {
    const L = outputs[0][0];
    const R = outputs[0][1] || L;

    for (let i = 0; i < L.length; i++) {
      let v = 0;

      try {
        v = this.runner(this.t);
      } catch {
        v = 0;
      }

      let l = v, r = v;

      if (Array.isArray(v)) {
        l = v[0];
        r = v[1];
      }

      if (l > 1 || l < -1) l = ((l & 255) / 128) - 1;
      if (r > 1 || r < -1) r = ((r & 255) / 128) - 1;

      L[i] = l;
      R[i] = r;

      this.t += this.step;
    }

    return true;
  }
}

registerProcessor("bytebeat", BytebeatProcessor);
