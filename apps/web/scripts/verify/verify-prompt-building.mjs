// Ad-hoc verification (not part of the repo). Tests the pure prompt-building
// logic in ../../app/api/agent/next-action/prompt.ts directly - no Next.js
// server, no Electron, no network. Run with:
//   cd apps/web && node --experimental-strip-types scripts/verify/verify-prompt-building.mjs
//
// This replaces the old apps/desktop/scripts/verify/verify-history-truncation.js,
// which tested this exact logic (history truncation in buildUserPrompt) back
// when it lived in apps/desktop/src/ai/grok.ts. The logic moved here on
// 2026-10-07 (ai/grok.ts now just calls this server instead of building the
// xAI prompt itself - see the root-cause network fix in route.ts's main
// comment) - the behavior under test is identical, only its location changed.
import { buildUserPrompt, extractJson, isValidRiskClass, MAX_HISTORY_ENTRIES_IN_PROMPT } from "../../app/api/agent/next-action/prompt.ts";

const results = [];
function check(label, cond) {
  results.push({ label, ok: Boolean(cond) });
  console.log((cond ? "PASS" : "FAIL") + " - " + label);
}

// === History truncation (same assertions as the retired desktop test) ===
{
  const history = [];
  for (let i = 1; i <= 30; i++) {
    history.push({ reasoning: `סיבה מספר ${i}`, action: { type: "wait", ms: 100 } });
  }
  const promptText = buildUserPrompt({
    task: "test task",
    screenWidth: 1000,
    screenHeight: 800,
    history,
    knownScreens: [],
    hasSavedCredentials: false,
  });

  check("the truncation note mentions exactly 10 hidden steps (30 - 20 shown)", promptText.includes("10 צעדים קודמים נוספים"));
  check("entry #10 (should be hidden) is NOT in the sent prompt", !promptText.includes("סיבה מספר 10 "));
  check("entry #11 (first of the last 20) IS in the sent prompt, numbered 11", promptText.includes("11. סיבה מספר 11"));
  check("entry #30 (most recent) IS in the sent prompt, numbered 30", promptText.includes("30. סיבה מספר 30"));
  check(
    "exactly MAX_HISTORY_ENTRIES_IN_PROMPT numbered lines appear in the history section",
    (promptText.match(/^\d+\. סיבה מספר/gm) || []).length === MAX_HISTORY_ENTRIES_IN_PROMPT,
  );
}

// === Short history (under the cap) - completely unaffected, no truncation note ===
{
  const shortPromptText = buildUserPrompt({
    task: "test task 2",
    screenWidth: 1000,
    screenHeight: 800,
    history: [{ reasoning: "רק אחד", action: { type: "wait", ms: 100 } }],
    knownScreens: [],
    hasSavedCredentials: false,
  });
  check("short history has no truncation note", !shortPromptText.includes("צעדים קודמים נוספים"));
  check("short history entry appears numbered 1 (unaffected)", shortPromptText.includes("1. רק אחד"));
}

// === Known screens / credentials text ===
{
  const withScreens = buildUserPrompt({
    task: "t", screenWidth: 10, screenHeight: 10, history: [], knownScreens: ["מסך פתיחה", "טופס לקוח"], hasSavedCredentials: true,
  });
  check("known screens are joined into the prompt", withScreens.includes("מסך פתיחה, טופס לקוח"));
  check("hasSavedCredentials:true mentions it's allowed to use type_credential", withScreens.includes("מותר להשתמש ב-type_credential"));

  const withoutScreens = buildUserPrompt({
    task: "t", screenWidth: 10, screenHeight: 10, history: [], knownScreens: [], hasSavedCredentials: false,
  });
  check("no known screens -> placeholder text shown", withoutScreens.includes("אין עדיין מסכים מוכרים"));
  check("hasSavedCredentials:false says not to use type_credential", withoutScreens.includes("אל תשתמש ב-type_credential"));
}

// === extractJson - same fail-closed parsing the server relies on ===
{
  check("extractJson parses clean JSON directly", extractJson('{"a":1}').a === 1);
  check("extractJson extracts JSON embedded in surrounding text", extractJson('here is the answer: {"a":2} - done').a === 2);
  let threw = false;
  try { extractJson("no json here at all"); } catch { threw = true; }
  check("extractJson throws when there's no JSON object in the content", threw);
}

// === isValidRiskClass ===
{
  check("isValidRiskClass accepts a real category", isValidRiskClass("final-commit") === true);
  check("isValidRiskClass rejects an invented string", isValidRiskClass("super-safe") === false);
  check("isValidRiskClass rejects non-string input", isValidRiskClass(42) === false && isValidRiskClass(undefined) === false);
}

const allOk = results.every((r) => r.ok);
console.log(JSON.stringify({ allOk, total: results.length, failed: results.filter((r) => !r.ok).map((r) => r.label) }, null, 2));
process.exit(allOk ? 0 : 1);
