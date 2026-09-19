import { app, safeStorage } from "electron";
import path from "node:path";
import fs from "node:fs";

interface ConnectorCredentials {
  username: string;
  password: string;
}

interface StoredSettings {
  xaiApiKey?: string;
  connectorCredentials?: Record<string, ConnectorCredentials>;
}

function settingsFile(): string {
  return path.join(app.getPath("userData"), "settings.enc");
}

function readSettings(): StoredSettings {
  try {
    if (!safeStorage.isEncryptionAvailable()) return {};
    const buf = fs.readFileSync(settingsFile());
    return JSON.parse(safeStorage.decryptString(buf)) as StoredSettings;
  } catch {
    return {};
  }
}

/**
 * מחזיר false (לא זורק) אם הצפנה לא זמינה במערכת ההפעלה - מצב נדיר בפועל על
 * Windows (DPAPI כמעט תמיד זמין), אבל קורה ב-Linux/Xvfb ללא keyring רץ, למשל
 * בבדיקות אוטומטיות. השכבה שמעל (IPC handler) מחזירה הודעה ברורה למשתמש
 * במקום קריסה לא מוסברת.
 */
function writeSettings(settings: StoredSettings): boolean {
  if (!safeStorage.isEncryptionAvailable()) return false;
  const buf = safeStorage.encryptString(JSON.stringify(settings));
  fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
  fs.writeFileSync(settingsFile(), buf);
  return true;
}

export function isSecureStorageAvailable(): boolean {
  return safeStorage.isEncryptionAvailable();
}

export function getXaiApiKey(): string | undefined {
  return readSettings().xaiApiKey;
}

export function hasXaiApiKey(): boolean {
  return Boolean(getXaiApiKey());
}

export function setXaiApiKey(key: string): boolean {
  return writeSettings({ ...readSettings(), xaiApiKey: key });
}

export function clearXaiApiKey(): boolean {
  const current = readSettings();
  delete current.xaiApiKey;
  return writeSettings(current);
}

/**
 * פרטי התחברות לתוכנות (חשבשבת וכו') - נשמרים לוקאלית ומוצפנים בדיוק כמו
 * מפתח ה-API (safeStorage, לעולם לא עוזב את המחשב). הסיסמה בפועל לא עוברת
 * דרך ה-AI ולא נשמרת ביומן הריצות - ר' task-runner.ts (action מסוג
 * "type_credential") שמפריד בין ההחלטה של המודל ("הזן סיסמה שמורה") לבין
 * הערך עצמו, שנשלף כאן רק ברגע הביצוע בפועל.
 */
export function getConnectorCredentials(connectorId: string): ConnectorCredentials | undefined {
  return readSettings().connectorCredentials?.[connectorId];
}

export function hasConnectorCredentials(connectorId: string): boolean {
  return Boolean(getConnectorCredentials(connectorId));
}

export function setConnectorCredentials(connectorId: string, username: string, password: string): boolean {
  const current = readSettings();
  return writeSettings({
    ...current,
    connectorCredentials: { ...current.connectorCredentials, [connectorId]: { username, password } },
  });
}

export function clearConnectorCredentials(connectorId: string): boolean {
  const current = readSettings();
  const connectorCredentials = { ...current.connectorCredentials };
  delete connectorCredentials[connectorId];
  return writeSettings({ ...current, connectorCredentials });
}
