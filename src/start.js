// Entry point used by the launchers: prints what is happening before the server's modules load,
// so the small window never sits blank while a slow Mac starts up.
const t0 = Date.now();
const say = (m) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${m}`);
say(`Sardiye Studio is starting (node ${process.version}, ${process.platform} ${process.arch})`);
say("Loading the app");
try {
  await import("./server.js");
  say("Loaded. Waiting for the web address to come up");
} catch (e) {
  console.error("\nSardiye Studio could not start:\n" + (e && e.stack || e) + "\n\nTake a photo of this window and send it to Chadi.");
  process.exitCode = 1;
}
