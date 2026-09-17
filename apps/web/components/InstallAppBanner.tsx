"use client";

import { useEffect, useState } from "react";
import { DESKTOP_APP_DOWNLOAD_URL } from "@/lib/desktop-app";

export function InstallAppBanner() {
  const [isElectron, setIsElectron] = useState(false); // ברירת מחדל: מוצג (רוב המבקרים הם דפדפן רגיל)

  useEffect(() => {
    // window.electronAPI קיים רק בתוך אפליקציית ה-Desktop; קריאה חד-פעמית ב-mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsElectron(Boolean(window.electronAPI));
  }, []);

  if (isElectron) return null;

  return (
    <div className="mb-8 flex flex-col items-start gap-3 rounded-xl border border-indigo-200 bg-indigo-50 p-5 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h2 className="font-semibold text-indigo-900">הפוך לאפליקציה</h2>
        <p className="mt-1 text-sm text-indigo-800">
          התקנה חד-פעמית - קיצור דרך עם לוגו על שולחן העבודה, ופתיחה ישירה של תוכנות מותקנות
          בלחיצת כפתור.
        </p>
      </div>
      <a
        href={DESKTOP_APP_DOWNLOAD_URL}
        className="inline-flex shrink-0 items-center justify-center rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-indigo-700"
      >
        הפוך לאפליקציה
      </a>
    </div>
  );
}
