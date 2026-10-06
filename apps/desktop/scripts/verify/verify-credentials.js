// Ad-hoc verification script (not part of the repo). safeStorage itself
// (OS keyring/DPAPI) isn't available in this sandbox under Xvfb - same
// constraint that already applies to the working xAI key feature, and not
// something this change touches. So we mock just that OS layer with a
// reversible fake cipher, to verify the actual logic this change adds:
// merging into the credentials map, per-connector isolation, and clearing -
// without needing a real OS keyring.
const { app, safeStorage } = require("electron");

const fakeKey = Buffer.from("test-key-not-real-crypto");
safeStorage.isEncryptionAvailable = () => true;
safeStorage.encryptString = (str) => Buffer.concat([fakeKey, Buffer.from(str, "utf-8")]);
safeStorage.decryptString = (buf) => buf.subarray(fakeKey.length).toString("utf-8");

app.setPath("userData", "/tmp/aiop-cred-test-userdata");

app.whenReady().then(() => {
  const settings = require(require("path").join(__dirname, "..", "..", "dist", "settings.js"));

  const results = [];
  function check(label, cond) {
    results.push({ label, ok: Boolean(cond) });
  }

  const connectorId = "test-connector";

  check("hasConnectorCredentials false before save", settings.hasConnectorCredentials(connectorId) === false);
  check("getConnectorCredentials undefined before save", settings.getConnectorCredentials(connectorId) === undefined);

  const saveOk = settings.setConnectorCredentials(connectorId, "test-user", "sup3r-s3cret-pw");
  check("setConnectorCredentials returns true", saveOk === true);

  const creds = settings.getConnectorCredentials(connectorId);
  check("hasConnectorCredentials true after save", settings.hasConnectorCredentials(connectorId) === true);
  check("username round-trips correctly", creds && creds.username === "test-user");
  check("password round-trips correctly", creds && creds.password === "sup3r-s3cret-pw");

  // xAI key coexists untouched by connector credential writes (shared settings file)
  settings.setXaiApiKey("xai-existing-key-should-survive");
  settings.setConnectorCredentials(connectorId, "test-user-2", "pw-2");
  check("xAI key untouched by a later connector-credentials save", settings.getXaiApiKey() === "xai-existing-key-should-survive");
  check("connector credentials updated correctly on second save", (() => {
    const c = settings.getConnectorCredentials(connectorId);
    return c && c.username === "test-user-2" && c.password === "pw-2";
  })());

  check("other connector independent before its own save", settings.hasConnectorCredentials("other-connector") === false);
  settings.setConnectorCredentials("other-connector", "user2", "pw2");
  const stillFirst = settings.getConnectorCredentials(connectorId);
  check(
    "first connector unaffected by second connector's save",
    stillFirst && stillFirst.username === "test-user-2" && stillFirst.password === "pw-2",
  );

  const clearOk = settings.clearConnectorCredentials(connectorId);
  check("clearConnectorCredentials returns true", clearOk === true);
  check("hasConnectorCredentials false after clear", settings.hasConnectorCredentials(connectorId) === false);
  check("other connector survives clearing the first one", settings.hasConnectorCredentials("other-connector") === true);
  check("xAI key survives clearing a connector's credentials", settings.getXaiApiKey() === "xai-existing-key-should-survive");

  settings.clearConnectorCredentials("other-connector");
  settings.clearXaiApiKey();
  const fs = require("fs");
  try { fs.rmSync("/tmp/aiop-cred-test-userdata", { recursive: true, force: true }); } catch {}

  const allOk = results.every((r) => r.ok);
  console.log(JSON.stringify({ allOk, results }, null, 2));
  app.exit(allOk ? 0 : 1);
});
