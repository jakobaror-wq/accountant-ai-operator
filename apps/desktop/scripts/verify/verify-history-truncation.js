// Ad-hoc verification (not part of the repo). Confirms buildUserPrompt's
// history truncation: with a long history, only the most recent N entries
// are sent to the AI verbatim, older ones are replaced by a count note, and
// step numbering in the sent text still continues correctly (doesn't reset
// to 1), so the model isn't confused about which step it's really on.
const { app, net } = require("electron");
app.setPath("userData", "/tmp/aiop-history-test-userdata");

app.whenReady().then(async () => {
  const DIST = require("path").join(__dirname, "..", "..", "dist");

  let capturedBody = null;
  net.fetch = async (url, init) => {
    capturedBody = JSON.parse(init.body);
    const promptText = capturedBody.messages[1].content[0].text;
    return {
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                reasoning: "test",
                screenLabel: "s",
                confidence: 0.99,
                requiresApproval: false,
                action: { type: "done", summary: "done" },
              }),
            },
          },
        ],
      }),
      text: async () => "",
    };
  };

  const grok = require(`${DIST}/ai/grok.js`);

  // Build a 30-entry history.
  const history = [];
  for (let i = 1; i <= 30; i++) {
    history.push({ reasoning: `סיבה מספר ${i}`, action: { type: "wait", ms: 100 } });
  }

  await grok.requestNextAction({
    apiKey: "dummy",
    task: "test task",
    screenshotBase64: "AAAA",
    screenWidth: 1000,
    screenHeight: 800,
    history,
    knownScreens: [],
    hasSavedCredentials: false,
  });

  const promptText = capturedBody.messages[1].content[0].text;
  const results = [];
  function check(label, cond) { results.push({ label, ok: Boolean(cond) }); }

  check("the truncation note mentions exactly 10 hidden steps (30 - 20 shown)", promptText.includes("10 צעדים קודמים נוספים"));
  check("entry #10 (should be hidden) is NOT in the sent prompt", !promptText.includes("סיבה מספר 10 "));
  check("entry #11 (first of the last 20) IS in the sent prompt, numbered 11", promptText.includes("11. סיבה מספר 11"));
  check("entry #30 (most recent) IS in the sent prompt, numbered 30", promptText.includes("30. סיבה מספר 30"));
  check("exactly 20 numbered lines appear in the history section", (promptText.match(/^\d+\. סיבה מספר/gm) || []).length === 20);

  // Short history (under the cap) should be completely unaffected - no truncation note at all.
  capturedBody = null;
  const shortHistory = [{ reasoning: "רק אחד", action: { type: "wait", ms: 100 } }];
  await grok.requestNextAction({
    apiKey: "dummy", task: "test task 2", screenshotBase64: "AAAA", screenWidth: 1000, screenHeight: 800,
    history: shortHistory, knownScreens: [], hasSavedCredentials: false,
  });
  const shortPromptText = capturedBody.messages[1].content[0].text;
  check("short history has no truncation note", !shortPromptText.includes("צעדים קודמים נוספים"));
  check("short history entry appears numbered 1 (unaffected)", shortPromptText.includes("1. רק אחד"));

  const fs = require("fs");
  try { fs.rmSync("/tmp/aiop-history-test-userdata", { recursive: true, force: true }); } catch {}

  const allOk = results.every((r) => r.ok);
  console.log(JSON.stringify({ allOk, results }, null, 2));
  app.exit(allOk ? 0 : 1);
});
