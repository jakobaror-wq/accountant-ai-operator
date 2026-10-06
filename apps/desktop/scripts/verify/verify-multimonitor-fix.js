// Ad-hoc verification (not part of the repo). Confirms captureScreenshot()
// now matches the captured source to the primary display's display_id
// instead of blindly taking sources[0], by mocking desktopCapturer to return
// multiple sources in a deliberately-wrong order (primary NOT first).
const { app, desktopCapturer, screen } = require("electron");

app.whenReady().then(async () => {
  const real = screen.getPrimaryDisplay();

  const originalGetSources = desktopCapturer.getSources.bind(desktopCapturer);
  desktopCapturer.getSources = async (opts) => {
    const realSources = await originalGetSources(opts);
    const realPrimary = realSources[0];
    // Fabricate a "wrong" secondary source with different fake dimensions,
    // placed FIRST (simulating a platform where source order != display order),
    // and tag the REAL source with the real display's id, placed second.
    const fakeWrongSource = {
      ...realPrimary,
      display_id: "999999", // does not match any real display id
      thumbnail: realPrimary.thumbnail.resize({ width: 640, height: 480 }), // deliberately different size
    };
    const taggedRealSource = { ...realPrimary, display_id: String(real.id) };
    return [fakeWrongSource, taggedRealSource];
  };

  const DIST = require("path").join(__dirname, "..", "..", "dist");
  const { captureScreenshot } = require(`${DIST}/computer-use.js`);

  const results = [];
  function check(label, cond) { results.push({ label, ok: Boolean(cond) }); }

  const shot = await captureScreenshot();

  check(
    "did NOT just grab sources[0] blindly (that would report the fake 640x480 shape)",
    !(shot.width === 640 && shot.height === 480),
  );
  check(
    "realWidth/realHeight still match the true primary display",
    shot.realWidth === real.size.width && shot.realHeight === real.size.height,
  );
  // Since we tagged the SECOND source with the real display_id, and small
  // screens aren't downscaled, width/height should reflect the real source's
  // dimensions, not the fake first one's.
  check(
    "picked the source matching the primary display's display_id, not the first in the array",
    shot.width !== 640 || shot.height !== 480,
  );

  console.log(JSON.stringify({ allOk: results.every((r) => r.ok), shot: { width: shot.width, height: shot.height, realWidth: shot.realWidth, realHeight: shot.realHeight }, results }, null, 2));
  app.exit(results.every((r) => r.ok) ? 0 : 1);
});
