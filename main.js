let ctx = null;
let node = null;
let fn = null;

function compile(code) {
  // IMPORTANT: NO with, NO eval per sample, just compile once
  return new Function("t", "env", `
    const sin=Math.sin, cos=Math.cos, tan=Math.tan;
    const abs=Math.abs, pow=Math.pow, floor=Math.floor;

    let random=Math.random;

    return (${code});
  `);
}

async function start() {
  const code = document.getElementById("code").value;
  const rate = Number(document.getElementById("rate").value);

  if (!ctx) {
    ctx = new AudioContext();
    await ctx.audioWorklet.addModule("worklet.js");
  }

  if (ctx.state === "suspended") {
    await ctx.resume();
  }

  fn = compile(code);

  if (node) node.disconnect();

  node = new AudioWorkletNode(ctx, "bytebeat");

  node.port.postMessage({
    fn: fn.toString(),
    rate
  });

  node.connect(ctx.destination);
}

function stop() {
  if (node) node.disconnect();
  if (ctx) ctx.suspend();
}

function reset() {
  node?.port.postMessage({ reset: true });
}

document.getElementById("play").onclick = start;
document.getElementById("stop").onclick = stop;
document.getElementById("reset").onclick = reset;
