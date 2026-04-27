let ctx, node;

document.getElementById("play").onclick = async () => {
  if (!ctx) {
    ctx = new AudioContext();
    await ctx.audioWorklet.addModule("worklet.js");
  }

  if (node) node.disconnect();

  node = new AudioWorkletNode(ctx, "bytebeat");
  node.connect(ctx.destination);

  node.port.postMessage({
    code: document.getElementById("code").value,
    rate: Number(document.getElementById("rate").value)
  });
};

document.getElementById("stop").onclick = () => {
  if (node) node.disconnect();
};

document.getElementById("reset").onclick = () => {
  if (node) node.port.postMessage({ reset: true });
};
