// Ad-hoc verification (not part of the repo). Confirms captureScreenshot()'s
// new single-encode shape: correct field values, real PNG bytes, aspect
// ratio preserved when downscaled, and the small-screen path is untouched
// (width === realWidth, no resize triggered).
const { app } = require("electron");
app.whenReady().then(async () => {
  const DIST = require("path").join(__dirname, "..", "..", "dist");
  const { captureScreenshot } = require(`${DIST}/computer-use.js`);
  const { screen } = require("electron");

  const results = [];
  function check(label, cond) { results.push({ label, ok: Boolean(cond) }); }

  const shot = await captureScreenshot();
  const real = screen.getPrimaryDisplay().size;

  check("realWidth matches screen.getPrimaryDisplay().size.width", shot.realWidth === real.width);
  check("realHeight matches screen.getPrimaryDisplay().size.height", shot.realHeight === real.height);
  check("base64Png is a non-empty string", typeof shot.base64Png === "string" && shot.base64Png.length > 100);

  // Decode and check real PNG magic bytes + that decoded dimensions match reported width/height.
  const buf = Buffer.from(shot.base64Png, "base64");
  const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  check("decoded buffer starts with real PNG magic bytes", buf.subarray(0, 8).equals(PNG_MAGIC));
  // IHDR chunk: width at bytes 16-19, height at 20-23 (big-endian), right after the 8-byte signature + 4-byte length + 4-byte "IHDR".
  const pngWidth = buf.readUInt32BE(16);
  const pngHeight = buf.readUInt32BE(20);
  check("decoded PNG width matches reported width", pngWidth === shot.width);
  check("decoded PNG height matches reported height", pngHeight === shot.height);

  const longestSide = Math.max(real.width, real.height);
  if (longestSide > 1600) {
    check("large screen: reported dimensions are capped at 1600 on the long side", Math.max(shot.width, shot.height) <= 1600);
    const realRatio = real.width / real.height;
    const shotRatio = shot.width / shot.height;
    check("large screen: aspect ratio preserved within rounding", Math.abs(realRatio - shotRatio) < 0.02);
    check("large screen: width !== realWidth (a resize actually happened)", shot.width !== shot.realWidth);
  } else {
    check("small screen: width equals realWidth (no resize triggered, identical to old small-screen behavior)", shot.width === shot.realWidth);
    check("small screen: height equals realHeight", shot.height === shot.realHeight);
  }

  console.log("Screen size for this run:", real, "-> reported:", { width: shot.width, height: shot.height });
  const allOk = results.every((r) => r.ok);
  console.log(JSON.stringify({ allOk, results }, null, 2));
  app.exit(allOk ? 0 : 1);
});
