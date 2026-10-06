// Ad-hoc verification (not part of the repo) for computer-use.ts's new
// moveMouseVerified() - a suspected root cause found via live user evidence
// (2026-09-25): a screenshot showed the AI itself reasoning that its own
// previous clicks "landed outside the screen (x>1600) and therefore hit
// nothing" - meaning the AI IS deciding real actions (not stuck/not a
// network hang), but the clicks don't land where intended. Leading
// hypothesis: a coordinate-space mismatch between Electron's logical
// pixels (what the AI's coordinates and the screenshot are measured in)
// and the physical pixels nut-js's native mouse control actually uses on
// Windows when DPI scaling is above 100% (very common on ordinary laptops,
// never tested in this Linux sandbox).
//
// This test simulates exactly that mismatch with a fake "physical cursor"
// and confirms moveMouseVerified() detects the discrepancy via Electron's
// OWN screen.getCursorScreenPoint() (independent of nut-js) and corrects
// for it - landing the cursor at the intended LOGICAL point after all.
const { app, screen } = require("electron");

const results = [];
function check(label, cond) {
  results.push({ label, ok: Boolean(cond) });
  console.log((cond ? "PASS" : "FAIL") + " - " + label);
}

app.whenReady().then(async () => {
  const DIST = require("path").join(__dirname, "..", "..", "dist");
  const nutJs = require(require("path").join(__dirname, "..", "..", "node_modules", "@nut-tree-fork", "nut-js"));

  // === Scenario 1: simulated 125% Windows DPI scaling (very common) ===
  // Model: nut-js's mouse.setPosition(x,y) moves the PHYSICAL cursor to
  // exactly (x,y) (it is not DPI-aware and treats input as physical
  // pixels). Electron's screen.getCursorScreenPoint() reports the physical
  // cursor's position converted DOWN to logical pixels (physical/scale) -
  // exactly how Electron's screen module actually behaves relative to
  // native Win32 calls when a process isn't fully per-monitor-DPI-aware.
  {
    const REAL_SCALE_FACTOR = 1.25;
    let physicalCursor = { x: 0, y: 0 };
    let setPositionCalls = 0;

    nutJs.mouse.setPosition = async (point) => {
      setPositionCalls++;
      physicalCursor = { x: point.x, y: point.y };
    };
    nutJs.mouse.click = async () => {};
    nutJs.mouse.doubleClick = async () => {};
    screen.getCursorScreenPoint = () => ({
      x: Math.round(physicalCursor.x / REAL_SCALE_FACTOR),
      y: Math.round(physicalCursor.y / REAL_SCALE_FACTOR),
    });

    const computerUse = require(`${DIST}/computer-use.js`);
    await computerUse.executeAction({ type: "click", x: 1000, y: 500 });

    const finalLogical = screen.getCursorScreenPoint();
    check(
      "125% DPI mismatch: setPosition was called twice (initial attempt + one correction)",
      setPositionCalls === 2,
    );
    check(
      `125% DPI mismatch: after correction, the cursor reads back at the INTENDED logical point (got ${finalLogical.x},${finalLogical.y}, wanted 1000,500)`,
      Math.abs(finalLogical.x - 1000) <= 2 && Math.abs(finalLogical.y - 500) <= 2,
    );
  }

  // === Scenario 2: no DPI mismatch (scale factor 1, most common on Linux/exact-100% Windows) ===
  // Must NOT trigger a pointless "correction" - setPosition should be called exactly once.
  {
    let physicalCursor = { x: 0, y: 0 };
    let setPositionCalls = 0;
    nutJs.mouse.setPosition = async (point) => {
      setPositionCalls++;
      physicalCursor = { x: point.x, y: point.y };
    };
    nutJs.mouse.click = async () => {};
    screen.getCursorScreenPoint = () => ({ x: physicalCursor.x, y: physicalCursor.y });

    delete require.cache[require.resolve(`${DIST}/computer-use.js`)];
    const computerUse2 = require(`${DIST}/computer-use.js`);
    await computerUse2.executeAction({ type: "click", x: 300, y: 200 });

    check("no DPI mismatch: setPosition called only once (no unnecessary correction)", setPositionCalls === 1);
  }

  // === Scenario 3: a small (<=2px) discrepancy from rounding must NOT trigger a "correction" loop ===
  {
    let physicalCursor = { x: 0, y: 0 };
    let setPositionCalls = 0;
    nutJs.mouse.setPosition = async (point) => {
      setPositionCalls++;
      physicalCursor = { x: point.x, y: point.y };
    };
    nutJs.mouse.click = async () => {};
    // בפועל תמיד יש סטייה זעירה של פיקסל-שניים מעיגול - זה נורמלי, לא DPI.
    screen.getCursorScreenPoint = () => ({ x: physicalCursor.x + 1, y: physicalCursor.y - 1 });

    delete require.cache[require.resolve(`${DIST}/computer-use.js`)];
    const computerUse3 = require(`${DIST}/computer-use.js`);
    await computerUse3.executeAction({ type: "double_click", x: 700, y: 400 });

    check("tiny (1px) rounding-level discrepancy: does NOT trigger a correction", setPositionCalls === 1);
  }

  const allOk = results.every((r) => r.ok);
  console.log(JSON.stringify({ allOk, total: results.length, failed: results.filter((r) => !r.ok).map((r) => r.label) }, null, 2));
  app.exit(allOk ? 0 : 1);
});
