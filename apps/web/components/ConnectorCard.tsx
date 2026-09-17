"use client";

import { useEffect, useState } from "react";
import type { ConnectorDefinition } from "@/lib/connectors";

interface Props {
  connector: ConnectorDefinition;
}

export function ConnectorCard({ connector }: Props) {
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

      {isElectron ? (
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
      ) : (
        <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          החיבור ל{connector.name} מתבצע אוטומטית בתוך האפליקציה - עוד רגע.
        </p>
      )}
    </div>
  );
}
