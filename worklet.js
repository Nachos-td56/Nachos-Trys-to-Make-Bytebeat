class BytebeatProcessor extends AudioWorkletProcessor {
  constructor() {
    super();

    this.t = 0;
    this.step = 1;
    this.rand = 1;

    // PERSISTENT GLOBAL STATE (THIS IS THE FIX)
    this.env = {
      ec: new Array(12288).fill(0),
      A: [],
      n: 12288,
      random: () => {
        this.rand = (this.rand * 16807) % 2147483647;
        return this.rand / 2147483647;
      }
    };

    this.fn = null;

    this.port.onmessage = (e) => {
      if (e.data.reset) {
        this.t = 0;
        this.env.ec.fill(0);
        return;
      }

      if (e.data.rate) {
        this.step = e.data.rate / sampleRate;
      }

      if (e.data.fn) {
        this.fn = eval("(" + e.data.fn + ")");
      }
    };
  }

  process(_, outputs) {
    const L = outputs[0][0];
    const R = outputs[0][1] || L;

    for (let i = 0; i < L.length; i++) {
      let v = 0;

      try {
        v = this.fn(this.t, this.env);
      } catch {
        v = 0;
      }

      let l = 0, r = 0;

      if (Array.isArray(v)) {
        [l, r] = v;
      } else {
        l = r = v;
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
