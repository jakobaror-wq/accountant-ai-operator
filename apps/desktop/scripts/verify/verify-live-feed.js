// Ad-hoc verification (not part of the repo). Confirms the new live-view
// feature added 2026-10-07 in response to the user wanting the agent to
// "feel like someone is remote-controlling it" on /agent: an independent
// capture loop (NOT tied to the AI-decision cadence) streaming small JPEG
// frames + cursor position over two dedicated IPC channels, kept separate
// from aiop:task-update so it never pollutes run-history/the audit chain.
const { app } = require("electron");

app.whenReady().then(async () => {
  const DIST = require("path").join(__dirname, "..", "..", "dist");
  const { captureScreenshot, captureLiveFrame } = require(`${DIST}/computer-use.js`);
  const { startLiveFeed, stopLiveFeed } = require(`${DIST}/live-feed.js`);

  const results = [];
  function check(label, cond) { results.push({ label, ok: Boolean(cond) }); }

  // === Part 1: captureLiveFrame() itself - real desktopCapturer, no mocks
  // (same pattern as verify-screenshot-single-encode.js) ===
  const frame = await captureLiveFrame();
  check("base64Jpeg is a non-empty string", typeof frame.base64Jpeg === "string" && frame.base64Jpeg.length > 50);

  const buf = Buffer.from(frame.base64Jpeg, "base64");
  check("decoded buffer starts with real JPEG magic bytes (0xFFD8)", buf[0] === 0xff && buf[1] === 0xd8);

  // NOT asserted as a hard pass/fail: JPEG-vs-PNG size depends entirely on
  // image CONTENT (text/photo-like content favors JPEG heavily; this
  // sandbox's Xvfb desktop is near-flat-color, which PNG actually compresses
  // better than JPEG at low quality - the opposite of the real-world case
  // this feature is designed for, a real accounting-software screen with
  // text/tables/colors). Logged for visibility, not a real assertion here.
  const pngShot = await captureScreenshot();
  const pngBuf = Buffer.from(pngShot.base64Png, "base64");
  console.log(`(informational, not asserted - depends on screen content) live-frame JPEG=${buf.length}B vs AI screenshot PNG=${pngBuf.length}B`);

  // === Part 2: startLiveFeed/stopLiveFeed lifecycle - fake sender, no real display needed ===
  const liveFrameSends = [];
  const cursorSends = [];
  let destroyed = false;
  const fakeSender = {
    isDestroyed: () => destroyed,
    send: (channel, payload) => {
      if (channel === "aiop:live-frame") liveFrameSends.push(payload);
      else if (channel === "aiop:cursor-position") cursorSends.push(payload);
    },
  };

  startLiveFeed(fakeSender);
  await new Promise((resolve) => setTimeout(resolve, 1200));
  stopLiveFeed();

  check(`aiop:live-frame fired at roughly the expected ~400ms cadence (got ${liveFrameSends.length} sends in 1.2s)`, liveFrameSends.length >= 2);
  check(
    `aiop:cursor-position fired more often than live-frame (faster ~150ms cadence) (frame=${liveFrameSends.length}, cursor=${cursorSends.length})`,
    cursorSends.length > liveFrameSends.length,
  );
  check(
    "every live-frame payload carries a base64Jpeg string",
    liveFrameSends.every((p) => typeof p.base64Jpeg === "string" && p.base64Jpeg.length > 0),
  );
  check(
    "every cursor-position payload carries numeric x/y",
    cursorSends.every((p) => typeof p.x === "number" && typeof p.y === "number"),
  );

  // "no leaked interval" check: after stopLiveFeed(), nothing more should arrive.
  const countAfterStop = { frame: liveFrameSends.length, cursor: cursorSends.length };
  await new Promise((resolve) => setTimeout(resolve, 700));
  check(
    "no further sends after stopLiveFeed() (no leaked setInterval)",
    liveFrameSends.length === countAfterStop.frame && cursorSends.length === countAfterStop.cursor,
  );

  // === Part 3: the isDestroyed() guard - restart, mark destroyed, confirm no sends land ===
  liveFrameSends.length = 0;
  cursorSends.length = 0;
  destroyed = true;
  startLiveFeed(fakeSender);
  await new Promise((resolve) => setTimeout(resolve, 600));
  stopLiveFeed();
  check("no sends at all when sender.isDestroyed() is true throughout", liveFrameSends.length === 0 && cursorSends.length === 0);

  const allOk = results.every((r) => r.ok);
  console.log(JSON.stringify({ allOk, results: results.map((r) => ({ label: r.label, ok: r.ok })) }, null, 2));
  app.exit(allOk ? 0 : 1);
});
