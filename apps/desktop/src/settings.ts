import { app, safeStorage } from "electron";
import path from "node:path";
import fs from "node:fs";

interface StoredSettings {
  xaiApiKey?: string;
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
