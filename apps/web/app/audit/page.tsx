"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { CONNECTORS } from "@/lib/connectors";

type RunSummary = Awaited<ReturnType<NonNullable<Window["electronAPI"]>["listRuns"]>>[number];

const STATUS_LABELS: Record<RunSummary["status"], string> = {
  "in-progress": "לא הושלמה (הופסקה)",
  done: "הושלם",
  stopped: "נעצר",
  rejected: "נדחה",
  error: "שגיאה",
  "max-steps-reached": "הגיע למספר הצעדים המרבי",
};

const STATUS_COLORS: Record<RunSummary["status"], string> = {
  "in-progress": "text-amber-700",
  done: "text-emerald-700",
  stopped: "text-slate-500",
  rejected: "text-red-600",
  error: "text-red-600",
  "max-steps-reached": "text-amber-700",
};

function connectorName(id: string): string {
  return CONNECTORS.find((c) => c.id === id)?.name ?? id;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString("he-IL");
}

function downloadJson(filename: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function approvalSummary(run: RunSummary): string {
  const approvalSteps = run.steps.filter((s) => s.requiresApproval);
  if (approvalSteps.length === 0) return "לא נדרשו אישורים בריצה הזו";
  const approved = approvalSteps.filter((s) => s.decision === "approved").length;
  const rejected = approvalSteps.filter((s) => s.decision === "rejected").length;
  return `${approvalSteps.length} פעולות דרשו אישור - ${approved} אושרו${rejected > 0 ? `, ${rejected} נדחו` : ""}`;
}

export default function AuditPage() {
  const [isElectron, setIsElectron] = useState(false);
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [connectorFilter, setConnectorFilter] = useState<string>("all");

  useEffect(() => {
    if (typeof window === "undefined" || !window.electronAPI) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsElectron(true);
    window.electronAPI.listRuns().then(setRuns);
  }, []);

  const filteredRuns = useMemo(
    () => (connectorFilter === "all" ? runs : runs.filter((r) => r.connectorId === connectorFilter)),
    [runs, connectorFilter],
  );

  if (!isElectron) {
    return (
      <main className="mx-auto w-full max-w-lg flex-1 px-6 py-24 text-center">
        <h1 className="text-xl font-bold text-slate-900">יומן ביקורת</h1>
        <p className="mt-3 text-sm text-slate-600">
          זמין רק בתוך אפליקציית שולחן העבודה - שם נשמרות הריצות, לוקאלית בלבד.
        </p>
        <Link href="/download" className="mt-4 inline-block text-sm text-indigo-600 underline">
          הורדת אפליקציית שולחן העבודה
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-6 py-10">
      <h1 className="text-2xl font-bold text-slate-900">יומן ביקורת</h1>
      <p className="mt-2 text-sm text-slate-600">
        תיעוד מלא ותמידי של כל ריצה שה-AI ביצע: כל שלב, כל החלטה, מה אושר ומה נדחה - נשמר לוקאלית
        בלבד, לעולם לא בענן.
      </p>

      <div className="mt-6 flex items-center justify-between gap-3">
        <select
          value={connectorFilter}
          onChange={(e) => setConnectorFilter(e.target.value)}
          className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
        >
          <option value="all">כל התוכנות</option>
          {CONNECTORS.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        {filteredRuns.length > 0 && (
          <button
            type="button"
            onClick={() => downloadJson(`audit-trail-${new Date().toISOString().slice(0, 10)}.json`, filteredRuns)}
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-600 hover:border-slate-300"
          >
            ייצוא הכול (JSON)
          </button>
        )}
      </div>

      <div className="mt-4 flex flex-col gap-3">
        {filteredRuns.length === 0 && <p className="text-sm text-slate-400">אין עדיין ריצות שמורות.</p>}
        {filteredRuns.map((run) => (
          <details key={run.id} className="rounded-lg border border-slate-200 bg-white p-4 text-sm">
            <summary className="flex cursor-pointer items-center justify-between gap-2">
              <span className="flex flex-col">
                <span className="font-medium text-slate-800">{connectorName(run.connectorId)}</span>
                <span className="truncate text-slate-600">{run.task}</span>
              </span>
              <span className="flex shrink-0 flex-col items-end gap-1 text-xs text-slate-400">
                {formatTime(run.startedAt)}
                <span className={`font-medium ${STATUS_COLORS[run.status]}`}>{STATUS_LABELS[run.status]}</span>
              </span>
            </summary>

            {run.summary && <p className="mt-2 text-slate-600">{run.summary}</p>}
            <p className="mt-2 text-xs font-medium text-slate-500">{approvalSummary(run)}</p>

            <ol className="mt-2 flex flex-col gap-1 text-xs text-slate-500">
              {run.steps.map((step) => (
                <li key={step.step}>
                  {step.step}. [{step.screenLabel ?? "?"}
                  {typeof step.confidence === "number" && `, ביטחון ${Math.round(step.confidence * 100)}%`}]{" "}
                  {step.reasoning ?? step.error ?? step.outcome}
                  {step.action && ` → ${step.action.type}`}
                  {step.decision && ` (${step.decision === "approved" ? "אושר" : "נדחה"})`}
                </li>
              ))}
            </ol>

            <button
              type="button"
              onClick={() => downloadJson(`run-${run.id}.json`, run)}
              className="mt-3 text-xs font-medium text-indigo-600 underline"
            >
              ייצוא הריצה הזו
            </button>
          </details>
        ))}
      </div>
    </main>
  );
}
