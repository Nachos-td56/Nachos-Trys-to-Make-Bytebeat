class Bytebeat extends AudioWorkletProcessor {
  constructor() {
    super();

    this.t = 0;
    this.step = 1;

    this.fn = (t) => 0;

    this.port.onmessage = (e) => {
      if (e.data.reset) {
        this.t = 0;
        return;
      }

      if (e.data.step) {
        this.step = e.data.step;
      }

      if (e.data.fn) {
        this.fn = eval("(" + e.data.fn + ")");
      }
    };
  }

  process(_, outputs) {
    const outL = outputs[0][0];
    const outR = outputs[0][1] || outL;

    for (let i = 0; i < outL.length; i++) {
      let v = 0;

      try {
        v = this.fn(this.t);
      } catch {
        v = 0;
      }

      let l = v, r = v;

      if (Array.isArray(v)) {
        l = v[0];
        r = v[1];
      }

      // normalize
      if (l > 1 || l < -1) l = ((l & 255) / 128) - 1;
      if (r > 1 || r < -1) r = ((r & 255) / 128) - 1;

      outL[i] = l;
      outR[i] = r;

      this.t += this.step;
    }

    return true;
  }
}

registerProcessor("bytebeat", Bytebeat);
