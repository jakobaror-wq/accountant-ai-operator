"use client";

import { useEffect, useState, type DragEvent } from "react";
import type { ConnectorDefinition } from "@/lib/connectors";

interface Props {
  connector: ConnectorDefinition;
  /** נתיב שמור שכבר נשלף פעם אחת עבור כל התוכנות יחד (ר' IntegrationsGrid) -
   * לא נשלף כאן שוב per-card, כדי לא לכפול קריאות IPC/קריאות דיסק מיותרות. */
  path: string | null;
}

const DROP_ERROR_MESSAGES: Record<string, string> = {
  "invalid-shortcut": "לא הצלחתי לקרוא את קיצור הדרך הזה - נסה לגרור ישירות את קובץ ה-exe.",
  "target-not-found": "הקובץ שאליו הקיצור מצביע לא נמצא.",
};

export function ConnectorCard({ connector, path }: Props) {
  const [isElectron, setIsElectron] = useState(false);
  const [chosenPath, setChosenPath] = useState<string | null>(path);
  const [launchError, setLaunchError] = useState<string | null>(null);
  const [dropError, setDropError] = useState<string | null>(null);
  const [isDraggingOver, setIsDraggingOver] = useState(false);

  useEffect(() => {
    // window.electronAPI קיים רק בתוך אפליקציית ה-Desktop (preload), לעולם לא ב-SSR/דפדפן רגיל.
    if (typeof window === "undefined" || !window.electronAPI) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsElectron(true);
  }, []);

  useEffect(() => {
    // path מגיע מ-IPC אסינכרוני ב-IntegrationsGrid ומתעדכן מ-null לערך האמיתי
    // אחרי ה-mount הראשוני - צריך לסנכרן את זה ל-state המקומי (שגם מתעדכן
    // עצמאית אחר כך ע"י pickExecutable/resolveDroppedPath).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setChosenPath(path);
  }, [path]);

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

  function handleDragOver(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDraggingOver(true);
  }

  function handleDragLeave() {
    setIsDraggingOver(false);
  }

  async function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDraggingOver(false);
    setDropError(null);
    if (!window.electronAPI) return;

    const file = e.dataTransfer.files[0];
    // ב-Electron, אובייקט File שנגרר נושא גם path מוחלט במערכת הקבצים - הרחבה
    // ייחודית ל-Electron שלא קיימת ב-DOM הסטנדרטי, ולכן ה-cast.
    const droppedPath = (file as File & { path?: string })?.path;
    if (!droppedPath) return;

    const result = await window.electronAPI.resolveDroppedPath(connector.id, droppedPath);
    if (result.success && result.path) {
      setChosenPath(result.path);
    } else {
      setDropError(DROP_ERROR_MESSAGES[result.error ?? ""] ?? "לא הצלחתי לזהות את התוכנה מהקובץ שנגרר.");
    }
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm flex flex-col gap-4">
      <div>
        <h3 className="text-lg font-semibold text-slate-900">{connector.name}</h3>
        <p className="text-sm text-slate-500">{connector.description}</p>
      </div>

      {isElectron ? (
        <div className="flex flex-col gap-2">
          <div
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            className={`rounded-lg border-2 border-dashed p-3 text-center text-xs transition-colors ${
              isDraggingOver
                ? "border-indigo-400 bg-indigo-50 text-indigo-700"
                : "border-slate-200 text-slate-400"
            }`}
          >
            גרור לכאן את קיצור הדרך או קובץ ה-exe של {connector.name}
          </div>

          <button
            type="button"
            onClick={handlePickExecutable}
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-600 hover:border-slate-300"
          >
            {chosenPath ? "שנה בחירה" : "או בחר תוכנה מהתיקייה"}
          </button>
          {chosenPath && (
            <p className="truncate text-xs text-slate-400" dir="ltr" title={chosenPath}>
              {chosenPath}
            </p>
          )}
          {dropError && <p className="text-xs text-red-600">{dropError}</p>}
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
