// Ad-hoc verification (not part of the repo). Confirms the module-load-time
// config mutation in computer-use.js actually took effect on the real
// singleton config objects. Deliberately does NOT invoke real native
// mouse/keyboard input (no focused window exists in this headless test
// context, and prior attempts showed that hangs indefinitely rather than
// failing fast) - the delay-application logic itself (sleep(autoDelayMs)
// before each action, read fresh from config every call) was already
// confirmed by directly reading nut-js's own source (mouse.class.js,
// keyboard.class.js), which is authoritative library behavior, not this
// project's own logic to re-derive here.
const { app } = require("electron");
app.whenReady().then(async () => {
  const DIST = require("path").join(__dirname, "..", "..", "dist");
  require(`${DIST}/computer-use.js`);
  const { mouse, keyboard } = require(require("path").join(__dirname, "..", "..", "node_modules", "@nut-tree-fork", "nut-js"));

  const results = [];
  function check(label, cond) { results.push({ label, ok: Boolean(cond) }); }

  check("mouse.config.autoDelayMs was reduced to 20 (from nut-js's default 100)", mouse.config.autoDelayMs === 20);
  check("keyboard.config.autoDelayMs was reduced to 30 (from nut-js's default 300)", keyboard.config.autoDelayMs === 30);
  check("mouseSpeed is untouched (setPosition is already instant, no need to change it)", mouse.config.mouseSpeed === 1000);

  const allOk = results.every((r) => r.ok);
  console.log(JSON.stringify({ allOk, results }, null, 2));
  app.exit(allOk ? 0 : 1);
});
