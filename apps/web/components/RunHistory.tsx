"use client";

import { useEffect, useState } from "react";

type RunSummary = Awaited<ReturnType<NonNullable<Window["electronAPI"]>["listRuns"]>>[number];

const STATUS_LABELS: Record<RunSummary["status"], string> = {
  done: "הושלם",
  stopped: "נעצר",
  rejected: "נדחה",
  error: "שגיאה",
  "max-steps-reached": "הגיע למספר הצעדים המרבי",
};

const STATUS_COLORS: Record<RunSummary["status"], string> = {
  done: "text-emerald-700",
  stopped: "text-slate-500",
  rejected: "text-red-600",
  error: "text-red-600",
  "max-steps-reached": "text-amber-700",
};

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString("he-IL");
}

interface Props {
  refreshSignal: number;
}

export function RunHistory({ refreshSignal }: Props) {
  const [open, setOpen] = useState(false);
  const [runs, setRuns] = useState<RunSummary[]>([]);

  useEffect(() => {
    if (!open || !window.electronAPI) return;
    window.electronAPI.listRuns().then(setRuns);
  }, [open, refreshSignal]);

  return (
    <div className="mt-8 border-t border-slate-200 pt-6">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="text-sm font-medium text-slate-600 underline"
      >
        {open ? "הסתר" : "הצג"} היסטוריית ריצות ({runs.length > 0 && open ? runs.length : "..."})
      </button>

      {open && (
        <div className="mt-4 flex flex-col gap-3">
          {runs.length === 0 && <p className="text-sm text-slate-400">אין עדיין ריצות שמורות.</p>}
          {runs.map((run) => (
            <details key={run.id} className="rounded-lg border border-slate-200 bg-white p-3 text-sm">
              <summary className="flex cursor-pointer items-center justify-between gap-2">
                <span className="truncate text-slate-700">{run.task}</span>
                <span className="flex shrink-0 items-center gap-2 text-xs text-slate-400">
                  {formatTime(run.startedAt)}
                  <span className={`font-medium ${STATUS_COLORS[run.status]}`}>{STATUS_LABELS[run.status]}</span>
                </span>
              </summary>
              {run.summary && <p className="mt-2 text-slate-600">{run.summary}</p>}
              <ol className="mt-2 flex flex-col gap-1 text-xs text-slate-500">
                {run.steps.map((step) => (
                  <li key={step.step}>
                    {step.step}. {step.reasoning ?? step.error ?? step.outcome}
                    {step.action && ` → ${step.action.type}`}
                    {step.decision && ` (${step.decision === "approved" ? "אושר" : "נדחה"})`}
                  </li>
                ))}
              </ol>
            </details>
          ))}
        </div>
      )}
    </div>
  );
}
