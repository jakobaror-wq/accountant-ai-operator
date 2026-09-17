"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

interface LogLine {
  step: number;
  kind: "reasoning" | "error" | "status";
  text: string;
}

interface PendingApproval {
  step: number;
  reasoning: string;
  actionLabel: string;
}

function describeAction(action: { type: string } & Record<string, unknown>): string {
  switch (action.type) {
    case "click":
      return `קליק בנקודה (${action.x}, ${action.y})`;
    case "double_click":
      return `קליק כפול בנקודה (${action.x}, ${action.y})`;
    case "type":
      return `הקלדת הטקסט: "${action.text}"`;
    case "key":
      return `לחיצה על המקש: ${action.key}`;
    case "scroll":
      return "גלילה";
    default:
      return action.type as string;
  }
}

export default function AgentPage() {
  const [isElectron, setIsElectron] = useState(false);
  const [hasKey, setHasKey] = useState(false);
  const [keyInput, setKeyInput] = useState("");
  const [savingKey, setSavingKey] = useState(false);

  const [keySaveError, setKeySaveError] = useState<string | null>(null);
  const [task, setTask] = useState("");
  const [running, setRunning] = useState(false);
  const [log, setLog] = useState<LogLine[]>([]);
  const [latestScreenshot, setLatestScreenshot] = useState<string | null>(null);
  const [pendingApproval, setPendingApproval] = useState<PendingApproval | null>(null);
  const logEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (typeof window === "undefined" || !window.electronAPI) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsElectron(true);
    window.electronAPI.getXaiKeyStatus().then(setHasKey);

    const unsubscribe = window.electronAPI.onTaskUpdate((event) => {
      switch (event.type) {
        case "step-start":
          setLog((prev) => [...prev, { step: event.step, kind: "status", text: `שלב ${event.step}...` }]);
          break;
        case "screenshot":
          setLatestScreenshot(event.base64Png);
          break;
        case "action":
          setLog((prev) => [
            ...prev,
            { step: event.step, kind: "reasoning", text: `${event.reasoning} → ${event.action.type}` },
          ]);
          break;
        case "awaiting-approval":
          setPendingApproval({
            step: event.step,
            reasoning: event.reasoning,
            actionLabel: describeAction(event.action),
          });
          break;
        case "rejected":
          setPendingApproval(null);
          setLog((prev) => [...prev, { step: event.step, kind: "status", text: "הפעולה נדחתה - המשימה נעצרה" }]);
          setRunning(false);
          break;
        case "error":
          setPendingApproval(null);
          setLog((prev) => [...prev, { step: event.step, kind: "error", text: event.message }]);
          setRunning(false);
          break;
        case "done":
          setPendingApproval(null);
          setLog((prev) => [...prev, { step: 0, kind: "status", text: `הושלם: ${event.summary}` }]);
          setRunning(false);
          break;
        case "stopped":
          setPendingApproval(null);
          setLog((prev) => [...prev, { step: 0, kind: "status", text: "נעצר על ידי המשתמש" }]);
          setRunning(false);
          break;
        case "max-steps-reached":
          setPendingApproval(null);
          setLog((prev) => [...prev, { step: 0, kind: "error", text: "הגיע למספר הצעדים המרבי בלי לסיים" }]);
          setRunning(false);
          break;
      }
    });

    return unsubscribe;
  }, []);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [log]);

  async function handleSaveKey() {
    if (!window.electronAPI || !keyInput.trim()) return;
    setSavingKey(true);
    setKeySaveError(null);
    const success = await window.electronAPI.saveXaiKey(keyInput.trim());
    if (success) {
      setKeyInput("");
      setHasKey(true);
    } else {
      setKeySaveError(
        "לא ניתן לשמור את המפתח - שירות ההצפנה של מערכת ההפעלה לא זמין כרגע במחשב הזה.",
      );
    }
    setSavingKey(false);
  }

  async function handleClearKey() {
    if (!window.electronAPI) return;
    await window.electronAPI.clearXaiKey();
    setHasKey(false);
  }

  async function handleStart() {
    if (!window.electronAPI || !task.trim()) return;
    setLog([]);
    setLatestScreenshot(null);
    setPendingApproval(null);
    const result = await window.electronAPI.runTask(task.trim());
    if (result.started) {
      setRunning(true);
    } else {
      setLog([
        {
          step: 0,
          kind: "error",
          text: result.error === "no-api-key" ? "לא הוגדר מפתח API" : "משימה כבר רצה",
        },
      ]);
    }
  }

  async function handleStop() {
    if (!window.electronAPI) return;
    await window.electronAPI.stopTask();
  }

  async function handleApprove() {
    if (!window.electronAPI) return;
    setPendingApproval(null);
    await window.electronAPI.approveAction();
  }

  async function handleReject() {
    if (!window.electronAPI) return;
    setPendingApproval(null);
    await window.electronAPI.rejectAction();
  }

  if (!isElectron) {
    return (
      <main className="mx-auto w-full max-w-lg flex-1 px-6 py-24 text-center">
        <h1 className="text-xl font-bold text-slate-900">מסך ה-AI Agent</h1>
        <p className="mt-3 text-sm text-slate-600">
          זמין רק בתוך אפליקציית שולחן העבודה - היא זו שיכולה לצלם מסך ולהפעיל תוכנות בפועל.
        </p>
        <Link href="/download" className="mt-4 inline-block text-sm text-indigo-600 underline">
          הורדת אפליקציית שולחן העבודה
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-6 py-10">
      <h1 className="text-2xl font-bold text-slate-900">AI Agent</h1>
      <p className="mt-2 text-sm text-slate-600">
        תן משימה, וה-AI יפעיל את התוכנות המקומיות בעצמו: מצלם מסך, מחליט מה השלב הבא, ומבצע.
      </p>

      {!hasKey ? (
        <div className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-5">
          <h2 className="font-semibold text-amber-900">מפתח API של xAI (Grok) נדרש</h2>
          <p className="mt-1 text-sm text-amber-800">
            נשמר מוצפן על המחשב הזה בלבד, לא נשלח לענן שלנו.
          </p>
          <div className="mt-3 flex gap-2">
            <input
              type="password"
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
              placeholder="xai-..."
              dir="ltr"
              className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm"
            />
            <button
              type="button"
              onClick={handleSaveKey}
              disabled={savingKey || !keyInput.trim()}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              שמור
            </button>
          </div>
          {keySaveError && <p className="mt-2 text-sm text-red-600">{keySaveError}</p>}
        </div>
      ) : (
        <div className="mt-6 flex flex-col gap-4">
          <div className="flex items-center justify-between text-sm text-slate-500">
            <span>מפתח API מוגדר</span>
            <button type="button" onClick={handleClearKey} className="text-red-600 underline">
              מחק מפתח
            </button>
          </div>

          <textarea
            value={task}
            onChange={(e) => setTask(e.target.value)}
            disabled={running}
            placeholder='למשל: "פתח את חשבשבת ובדוק את מאזן הבוחן של לקוח X"'
            rows={3}
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
          />

          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleStart}
              disabled={running || !task.trim()}
              className="rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {running ? "רץ..." : "התחל"}
            </button>
            {running && (
              <button
                type="button"
                onClick={handleStop}
                className="rounded-lg border border-red-300 px-5 py-2.5 text-sm font-medium text-red-700 hover:bg-red-50"
              >
                עצור
              </button>
            )}
          </div>

          {pendingApproval && (
            <div className="rounded-xl border border-amber-300 bg-amber-50 p-5">
              <h2 className="font-semibold text-amber-900">נדרש אישור לפני ביצוע</h2>
              <p className="mt-1 text-sm text-amber-900">{pendingApproval.reasoning}</p>
              <p className="mt-2 text-sm font-medium text-amber-900">
                הפעולה המוצעת: {pendingApproval.actionLabel}
              </p>
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  onClick={handleApprove}
                  className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
                >
                  אשר
                </button>
                <button
                  type="button"
                  onClick={handleReject}
                  className="rounded-lg border border-red-300 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50"
                >
                  דחה ועצור
                </button>
              </div>
            </div>
          )}

          {(log.length > 0 || latestScreenshot) && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {latestScreenshot && (
                <div>
                  <span className="text-xs font-medium text-slate-500">צילום מסך אחרון</span>
                  <img
                    src={`data:image/png;base64,${latestScreenshot}`}
                    alt="צילום מסך אחרון"
                    className="mt-1 w-full rounded-lg border border-slate-200"
                  />
                </div>
              )}
              <div className="flex max-h-96 flex-col gap-1 overflow-y-auto rounded-lg border border-slate-200 bg-white p-3 text-sm">
                {log.map((line, i) => (
                  <div
                    key={i}
                    className={
                      line.kind === "error"
                        ? "text-red-600"
                        : line.kind === "status"
                          ? "font-medium text-slate-700"
                          : "text-slate-600"
                    }
                  >
                    {line.text}
                  </div>
                ))}
                <div ref={logEndRef} />
              </div>
            </div>
          )}
        </div>
      )}
    </main>
  );
}
