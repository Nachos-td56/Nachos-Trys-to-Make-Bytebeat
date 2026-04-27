let ctx = null;
let node = null;
let fn = null;
let step = 1;

function compile(code) {
  return new Function("t", `
    const sin=Math.sin, cos=Math.cos, tan=Math.tan;
    const abs=Math.abs, pow=Math.pow, floor=Math.floor;
    let random=Math.random;
    return (${code});
  `);
}

async function start() {
  // SAFE context handling
  if (!ctx || ctx.state === "closed") {
    ctx = new AudioContext();
    await ctx.audioWorklet.addModule("worklet.js");
  }

  if (ctx.state === "suspended") {
    await ctx.resume();
  }

  const rate = Number(document.getElementById("rate").value);
  step = rate / ctx.sampleRate;

  fn = new Function("t", "env", `
    with(env){
      return (${code});
    }
  `);

  if (node) node.disconnect();

  node = new AudioWorkletNode(ctx, "bytebeat");

  node.port.postMessage({
    fn: fn.toString(),
    step
  });

  node.connect(ctx.destination);
}

function stop() {
  if (node) {
    node.disconnect();
    node = null;
  }

  // IMPORTANT: do NOT close context aggressively
  // just suspend instead (safe + reusable)
  if (ctx && ctx.state !== "closed") {
    ctx.suspend();
  }
}

function reset() {
  node?.port.postMessage({ reset: true });
}

document.getElementById("play").onclick = start;
document.getElementById("stop").onclick = stop;
document.getElementById("reset").onclick = reset;
