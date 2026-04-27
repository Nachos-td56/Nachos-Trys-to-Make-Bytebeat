let ctx, node;
let t = 0;
let step = 1;
let fn;

function compile(code) {
  // Build function ONCE (not per sample)
  return new Function("t", `
    const sin=Math.sin, cos=Math.cos, tan=Math.tan;
    const abs=Math.abs, pow=Math.pow, floor=Math.floor;

    let random = Math.random;

    return (${code});
  `);
}

async function start() {
  if (ctx) await ctx.close();

  ctx = new AudioContext();
  const rate = Number(document.getElementById("rate").value);
  step = rate / ctx.sampleRate;

  await ctx.audioWorklet.addModule("worklet.js");

  fn = compile(document.getElementById("code").value);

  node = new AudioWorkletNode(ctx, "bytebeat");

  node.port.postMessage({ fn: fn.toString(), step });

  node.connect(ctx.destination);
}

document.getElementById("play").onclick = start;

document.getElementById("stop").onclick = () => {
  node?.disconnect();
  ctx?.close();
};

document.getElementById("reset").onclick = () => {
  node?.port.postMessage({ reset: true });
};
