import type { ConnectionType } from "./connectors";

export interface ConnectorConfig {
  type: ConnectionType | null;
  /** רק לחיבורי type: "browser" - הקישור להתחברות לתוכנה */
  url?: string;
}

const EMPTY_CONFIG: ConnectorConfig = { type: null };

function storageKey(connectorId: string): string {
  return `aiop.connector-config.v1.${connectorId}`;
}

/**
 * שכבת אחסון v1: localStorage בדפדפן, פר-משרד לא נתמך עדיין.
 * זהו שיפוט מכוון לגרסה ראשונה - ר' docs/01-ARCHITECTURE.md לתכנון סכימת Supabase
 * (טבלת connector_credential_ref) שתחליף את זה בשלב הבא, בלי לשנות את ה-API הזה.
 */
export function loadConnectorConfig(connectorId: string): ConnectorConfig {
  if (typeof window === "undefined") return EMPTY_CONFIG;
  try {
    const raw = window.localStorage.getItem(storageKey(connectorId));
    if (!raw) return EMPTY_CONFIG;
    const parsed = JSON.parse(raw) as ConnectorConfig;
    return parsed;
  } catch {
    return EMPTY_CONFIG;
  }
}

export function saveConnectorConfig(connectorId: string, config: ConnectorConfig): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(storageKey(connectorId), JSON.stringify(config));
}
