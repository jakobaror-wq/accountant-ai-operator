"use client";

import { useEffect, useState } from "react";
import type { ConnectorDefinition, ConnectionType } from "@/lib/connectors";
import { loadConnectorConfig, saveConnectorConfig } from "@/lib/connector-config-store";
import { buildLaunchUri } from "@/lib/local-launcher";
import Link from "next/link";

interface CardState {
  loaded: boolean;
  type: ConnectionType | null;
  url: string;
  savedUrl: string;
}

const INITIAL_STATE: CardState = { loaded: false, type: null, url: "", savedUrl: "" };

export function ConnectorCard({ connector }: { connector: ConnectorDefinition }) {
  const [state, setState] = useState<CardState>(INITIAL_STATE);
  const { loaded, type, url, savedUrl } = state;

  useEffect(() => {
    const config = loadConnectorConfig(connector.id);
    // localStorage אינו זמין בזמן ה-SSR; זו קריאה חד-פעמית בעת ה-mount כדי להימנע
    // מ-Hydration mismatch (השלד המוצג לפני loaded=true זהה למה שנשלח מהשרת).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setState({ loaded: true, type: config.type, url: config.url ?? "", savedUrl: config.url ?? "" });
  }, [connector.id]);

  function handleTypeChange(next: ConnectionType) {
    setState((prev) => ({ ...prev, type: next }));
    saveConnectorConfig(connector.id, { type: next, url });
  }

  function handleSaveUrl() {
    saveConnectorConfig(connector.id, { type, url });
    setState((prev) => ({ ...prev, savedUrl: url }));
  }

  if (!loaded) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm animate-pulse h-48" />
    );
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
              onChange={(e) => setState((prev) => ({ ...prev, url: e.target.value }))}
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

      {type === "desktop" && (
        <div className="flex flex-col gap-2">
          <a
            href={buildLaunchUri(connector.id)}
            className="inline-flex items-center justify-center rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
          >
            פתח את {connector.name}
          </a>
          <p className="text-xs text-slate-500">
            דורש Local Launcher מותקן על המחשב.{" "}
            <Link href="/integrations/local-launcher" className="text-indigo-600 underline">
              מדריך התקנה
            </Link>
          </p>
        </div>
      )}

      {type === null && (
        <p className="text-sm text-slate-400">בחר סוג חיבור כדי להמשיך</p>
      )}
    </div>
  );
}
