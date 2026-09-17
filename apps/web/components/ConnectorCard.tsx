"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { ConnectorDefinition, ConnectionType } from "@/lib/connectors";
import { saveConnectorConfig, type ConnectorConfig } from "@/lib/connector-configs-client";

interface Props {
  connector: ConnectorDefinition;
  officeId: string;
  initialConfig: ConnectorConfig;
}

export function ConnectorCard({ connector, officeId, initialConfig }: Props) {
  const [type, setType] = useState<ConnectionType | null>(initialConfig.type);
  const [url, setUrl] = useState(initialConfig.url ?? "");
  const [savedUrl, setSavedUrl] = useState(initialConfig.url ?? "");
  const [isElectron, setIsElectron] = useState(false);
  const [chosenPath, setChosenPath] = useState<string | null>(null);
  const [launchError, setLaunchError] = useState<string | null>(null);

  useEffect(() => {
    // window.electronAPI קיים רק בתוך אפליקציית ה-Desktop (preload), לעולם לא ב-SSR/דפדפן רגיל.
    // זיהוי חד-פעמי + שליפת נתיב שמור דרך IPC אסינכרוני, לא state שאפשר לגזור בזמן ה-render.
    if (typeof window === "undefined" || !window.electronAPI) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsElectron(true);
    window.electronAPI.getConnectorPaths().then((paths) => {
      setChosenPath(paths[connector.id] ?? null);
    });
  }, [connector.id]);

  async function handleTypeChange(next: ConnectionType) {
    setType(next);
    await saveConnectorConfig(officeId, connector.id, { type: next, url });
  }

  async function handleSaveUrl() {
    await saveConnectorConfig(officeId, connector.id, { type, url });
    setSavedUrl(url);
  }

  async function handlePickExecutable() {
    if (!window.electronAPI) return;
    const path = await window.electronAPI.pickExecutable(connector.id);
    if (path) setChosenPath(path);
  }

  async function handleLaunch() {
    if (!window.electronAPI) return;
    setLaunchError(null);
    const result = await window.electronAPI.launchExecutable(connector.id);
    if (!result.success) setLaunchError(result.error ?? "שגיאה לא ידועה");
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm flex flex-col gap-4">
      <div>
        <h3 className="text-lg font-semibold text-slate-900">{connector.name}</h3>
        <p className="text-sm text-slate-500">{connector.description}</p>
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-xs font-medium text-slate-500">סוג חיבור</span>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => handleTypeChange("browser")}
            className={`flex-1 rounded-lg border px-3 py-2 text-sm transition-colors ${
              type === "browser"
                ? "border-indigo-600 bg-indigo-50 text-indigo-700"
                : "border-slate-200 text-slate-600 hover:border-slate-300"
            }`}
          >
            דרך דפדפן
          </button>
          <button
            type="button"
            onClick={() => handleTypeChange("desktop")}
            className={`flex-1 rounded-lg border px-3 py-2 text-sm transition-colors ${
              type === "desktop"
                ? "border-indigo-600 bg-indigo-50 text-indigo-700"
                : "border-slate-200 text-slate-600 hover:border-slate-300"
            }`}
          >
            מותקן על המחשב
          </button>
        </div>
      </div>

      {type === "browser" && (
        <div className="flex flex-col gap-2">
          <label className="text-xs font-medium text-slate-500" htmlFor={`${connector.id}-url`}>
            כתובת ההתחברות של {connector.name}
          </label>
          <div className="flex gap-2">
            <input
              id={`${connector.id}-url`}
              type="url"
              inputMode="url"
              placeholder="https://..."
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm text-left"
              dir="ltr"
            />
            <button
              type="button"
              onClick={handleSaveUrl}
              className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-600 hover:border-slate-300"
            >
              שמור
            </button>
          </div>
          <a
            href={savedUrl || undefined}
            target="_blank"
            rel="noopener noreferrer"
            aria-disabled={!savedUrl}
            className={`mt-1 inline-flex items-center justify-center rounded-lg px-4 py-2 text-sm font-medium text-white transition-colors ${
              savedUrl ? "bg-indigo-600 hover:bg-indigo-700" : "pointer-events-none bg-slate-300"
            }`}
          >
            התחבר ל{connector.name}
          </a>
        </div>
      )}

      {type === "desktop" && isElectron && (
        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={handlePickExecutable}
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-600 hover:border-slate-300"
          >
            {chosenPath ? "שנה בחירה" : "בחר תוכנה"}
          </button>
          {chosenPath && (
            <p className="truncate text-xs text-slate-400" dir="ltr" title={chosenPath}>
              {chosenPath}
            </p>
          )}
          <button
            type="button"
            onClick={handleLaunch}
            disabled={!chosenPath}
            className="inline-flex items-center justify-center rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:pointer-events-none disabled:bg-slate-300"
          >
            פתח את {connector.name}
          </button>
          {launchError && <p className="text-xs text-red-600">{launchError}</p>}
        </div>
      )}

      {type === "desktop" && !isElectron && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          פתיחת תוכנה מותקנת דורשת את{" "}
          <Link href="/download" className="font-medium underline">
            אפליקציית שולחן העבודה
          </Link>
          .
        </div>
      )}

      {type === null && <p className="text-sm text-slate-400">בחר סוג חיבור כדי להמשיך</p>}
    </div>
  );
}
