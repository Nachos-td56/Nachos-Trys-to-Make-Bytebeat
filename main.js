let ctx = null;
let node = null;

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

  if (node) node.disconnect();

  node = new AudioWorkletNode(ctx, "bytebeat");

  node.port.postMessage({ code, rate });

  node.connect(ctx.destination);
}

function stop() {
  if (node) node.disconnect();
}

function reset() {
  node?.port.postMessage({ reset: true });
}

document.getElementById("play").onclick = start;
document.getElementById("stop").onclick = stop;
document.getElementById("reset").onclick = reset;
