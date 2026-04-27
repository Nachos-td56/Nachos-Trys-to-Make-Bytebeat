let ctx = null;
let node = null;
let fn = null;
let running = false;

function compile(code) {
  // Compile ONCE per change (not per sample)
  return new Function("t", "env", `
    with (env) {
      return (${code});
    }
  `);
}

async function start() {
  const code = document.getElementById("code").value;
  const rate = Number(document.getElementById("rate").value);

  // Create or resume AudioContext safely
  if (!ctx || ctx.state === "closed") {
    ctx = new AudioContext();
    await ctx.audioWorklet.addModule("worklet.js");
  }

  if (ctx.state === "suspended") {
    await ctx.resume();
  }

  fn = compile(code);

  // reset old node safely
  if (node) {
    node.port.postMessage({ reset: true });
    node.disconnect();
  }

  node = new AudioWorkletNode(ctx, "bytebeat");

  node.port.postMessage({
    fn: fn.toString(),
    rate
  });

  node.connect(ctx.destination);

  running = true;
}

function stop() {
  if (!running) return;

  if (node) {
    node.disconnect();
    node = null;
  }

  // IMPORTANT: suspend instead of close (prevents "already closed" crash)
  if (ctx && ctx.state !== "closed") {
    ctx.suspend();
  }

  running = false;
}

function reset() {
  if (node) {
    node.port.postMessage({ reset: true });
  }
}

// UI bindings
document.getElementById("play").onclick = start;
document.getElementById("stop").onclick = stop;
document.getElementById("reset").onclick = reset;
