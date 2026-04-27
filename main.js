let ctx, processor;
let t = 0;
let step = 1;
let func;
let playing = false;

function compile(code) {
  const state = {
    a: "",
    b: 0,
    c: 0,
    sin: Math.sin,
    cos: Math.cos,
    tan: Math.tan,
    abs: Math.abs,
    pow: Math.pow,
    floor: Math.floor,
    random: Math.random,
    cbrt: Math.cbrt
  };

  return function (t) {
    try {
      // wrap code in persistent scope
      return Function(
        "t",
        "state",
        `
        with (state) {
          return (${code});
        }
        `
      )(t, state);
    } catch {
      return 0;
    }
  };
}

function start() {
  if (playing) return;

  ctx = new AudioContext();
  const rate = Number(document.getElementById("rate").value);
  step = rate / ctx.sampleRate;

  func = compile(document.getElementById("code").value);

  const bufferSize = 1024;
  processor = ctx.createScriptProcessor(bufferSize, 0, 2);

  processor.onaudioprocess = (e) => {
    const L = e.outputBuffer.getChannelData(0);
    const R = e.outputBuffer.getChannelData(1);

    for (let i = 0; i < bufferSize; i++) {
      let v = 0;
      try { v = func(t); } catch {}

      let l, r;
      if (Array.isArray(v)) [l, r] = v;
      else l = r = v;

      if (l > 1 || l < -1) l = ((l & 255) / 128) - 1;
      if (r > 1 || r < -1) r = ((r & 255) / 128) - 1;

      L[i] = l;
      R[i] = r;

      t += step;
    }
  };

  processor.connect(ctx.destination);
  playing = true;
}

function stop() {
  if (!playing) return;
  processor.disconnect();
  ctx.close();
  playing = false;
}

document.getElementById("play").onclick = start;
document.getElementById("stop").onclick = stop;
document.getElementById("reset").onclick = () => t = 0;
