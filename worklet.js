class BytebeatProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.t = 0;
    this.step = 1;
    this.func = () => 0;

    this.port.onmessage = (e) => {
      if (e.data.reset) {
        this.t = 0;
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
    // Build a persistent closure scope
    this.func = new Function(`
      let sin=Math.sin, cos=Math.cos, tan=Math.tan,
          abs=Math.abs, pow=Math.pow, floor=Math.floor;

      let rand=1;
      function random(){
        rand = (rand * 16807) % 2147483647;
        return rand / 2147483647;
      }

      // user persistent variables live here

      return function(t){
        ${code}
      };
    `)();
  }

  process(inputs, outputs) {
    const L = outputs[0][0];
    const R = outputs[0][1] || L;

    for (let i = 0; i < L.length; i++) {
      let v = 0;

      try {
        v = this.func(this.t);
      } catch {
        v = 0;
      }

      let l, r;

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
