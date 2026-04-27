let ctx = null;
let node = null;

async function start() {
  const code = document.getElementById("code").value;
  const rate = Number(document.getElementById("rate").value);

  // Create context once
  if (!ctx) {
    ctx = new AudioContext();

    // IMPORTANT: must load successfully BEFORE node creation
    await ctx.audioWorklet.addModule("worklet.js");
  }

  // REQUIRED for autoplay policies
  if (ctx.state === "suspended") {
    await ctx.resume();
  }

  if (node) node.disconnect();

  node = new AudioWorkletNode(ctx, "bytebeat");

  node.port.postMessage({
    type: "code",
    code,
    rate
  });

  node.connect(ctx.destination);
}

function stop() {
  if (node) {
    node.disconnect();
    node = null;
  }
}

function reset() {
  node?.port.postMessage({ type: "reset" });
}

document.getElementById("play").onclick = start;
document.getElementById("stop").onclick = stop;
document.getElementById("reset").onclick = reset;
