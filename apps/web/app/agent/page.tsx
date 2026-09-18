"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { RunHistory } from "@/components/RunHistory";
import { CONNECTORS } from "@/lib/connectors";

interface LogLine {
  step: number;
  kind: "reasoning" | "error" | "status";
  text: string;
}

interface PendingApproval {
  step: number;
  reasoning: string;
  confidence: number;
  actionLabel: string;
}

interface PendingQuestion {
  step: number;
  question: string;
}

interface QueueItem {
  task: string;
  connectorId: string;
}

const CONFIDENCE_WARNING_THRESHOLD = 0.95;

type StoredRunRecord = NonNullable<Awaited<ReturnType<NonNullable<Window["electronAPI"]>["getIncompleteRun"]>>>;

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
  const [connectorId, setConnectorId] = useState(CONNECTORS[0]?.id ?? "");
  const [learnedScreenCount, setLearnedScreenCount] = useState(0);
  const [running, setRunning] = useState(false);
  const [log, setLog] = useState<LogLine[]>([]);
  const [latestScreenshot, setLatestScreenshot] = useState<string | null>(null);
  const [pendingApproval, setPendingApproval] = useState<PendingApproval | null>(null);
  const [pendingQuestion, setPendingQuestion] = useState<PendingQuestion | null>(null);
  const [answerInput, setAnswerInput] = useState("");
  const [historyRefresh, setHistoryRefresh] = useState(0);
  const [incompleteRun, setIncompleteRun] = useState<StoredRunRecord | null>(null);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [queueHalted, setQueueHalted] = useState(false);
  const [appVersion, setAppVersion] = useState<string | null>(null);
  const logEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (typeof window === "undefined" || !window.electronAPI) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsElectron(true);
    window.electronAPI.getXaiKeyStatus().then(setHasKey);
    window.electronAPI.getAppVersion().then(setAppVersion);

    // משחזר מצב אם משימה כבר רצה ברקע (תהליך הראשי) - למשל אחרי ניווט למסך
    // אחר וחזרה לכאן; ה-state של React מתאפס בכל mount, אבל המשימה בפועל
    // ממשיכה לרוץ ב-main process בלי קשר למה שמוצג על המסך.
    window.electronAPI.getAgentStatus().then((status) => {
      if (!status.running) return;
      setRunning(true);
      if (status.connectorId) setConnectorId(status.connectorId);
      if (status.task) setTask(status.task);
      if (status.pendingApproval) {
        setPendingApproval({
          step: status.pendingApproval.step,
          reasoning: status.pendingApproval.reasoning,
          confidence: status.pendingApproval.confidence,
          actionLabel: describeAction(status.pendingApproval.action),
        });
      }
      if (status.pendingQuestion) {
        setPendingQuestion({ step: status.pendingQuestion.step, question: status.pendingQuestion.question });
      }
    });

    const unsubscribe = window.electronAPI.onTaskUpdate((event) => {
      switch (event.type) {
        case "step-start":
          setLog((prev) => [...prev, { step: event.step, kind: "status", text: `שלב ${event.step}...` }]);
          break;
        case "screenshot":
          setLatestScreenshot(event.base64Png);
          break;
        case "action": {
          const confidencePct = Math.round(event.confidence * 100);
          const lowConfidence = event.confidence < CONFIDENCE_WARNING_THRESHOLD ? " ⚠️" : "";
          setLog((prev) => [
            ...prev,
            {
              step: event.step,
              kind: "reasoning",
              text: `[${event.screenLabel}, ביטחון ${confidencePct}%${lowConfidence}] ${event.reasoning} → ${event.action.type}`,
            },
          ]);
          break;
        }
        case "awaiting-approval":
          setPendingApproval({
            step: event.step,
            reasoning: event.reasoning,
            confidence: event.confidence,
            actionLabel: describeAction(event.action),
          });
          break;
        case "awaiting-answer":
          setPendingQuestion({ step: event.step, question: event.question });
          setLog((prev) => [...prev, { step: event.step, kind: "status", text: `שאלה מה-AI: ${event.question}` }]);
          break;
        case "rejected":
          setPendingApproval(null);
          setLog((prev) => [...prev, { step: event.step, kind: "status", text: "הפעולה נדחתה - המשימה נעצרה" }]);
          setRunning(false);
          setQueueHalted(true);
          break;
        case "error":
          setPendingApproval(null);
          setPendingQuestion(null);
          setLog((prev) => [...prev, { step: event.step, kind: "error", text: event.message }]);
          setRunning(false);
          setQueueHalted(true);
          break;
        case "done":
          setPendingApproval(null);
          setPendingQuestion(null);
          setLog((prev) => [...prev, { step: 0, kind: "status", text: `הושלם: ${event.summary}` }]);
          setRunning(false);
          setQueueHalted(false);
          break;
        case "stopped":
          setPendingApproval(null);
          setPendingQuestion(null);
          setLog((prev) => [...prev, { step: 0, kind: "status", text: "נעצר על ידי המשתמש" }]);
          setRunning(false);
          setQueueHalted(true);
          break;
        case "max-steps-reached":
          setPendingApproval(null);
          setPendingQuestion(null);
          setLog((prev) => [...prev, { step: 0, kind: "error", text: "הגיע למספר הצעדים המרבי בלי לסיים" }]);
          setRunning(false);
          setQueueHalted(true);
          break;
        case "run-summary":
          setHistoryRefresh((n) => n + 1);
          break;
      }
    });

    return unsubscribe;
  }, []);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [log]);

  useEffect(() => {
    if (!window.electronAPI || !connectorId) return;
    window.electronAPI.getLearnedScreens(connectorId).then((screens) => setLearnedScreenCount(screens.length));
  }, [connectorId, historyRefresh]);

  useEffect(() => {
    if (!window.electronAPI || !connectorId || running) return;
    window.electronAPI.getIncompleteRun(connectorId).then(setIncompleteRun);
  }, [connectorId, running, historyRefresh]);

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
    if (!window.electronAPI || !task.trim() || !connectorId) return;
    setLog([]);
    setLatestScreenshot(null);
    setPendingApproval(null);
    setPendingQuestion(null);
    setIncompleteRun(null);
    setQueueHalted(false);
    const result = await window.electronAPI.runTask(task.trim(), connectorId);
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

  async function startQueuedTask(item: QueueItem) {
    if (!window.electronAPI) return;
    setTask(item.task);
    setConnectorId(item.connectorId);
    setLog([]);
    setLatestScreenshot(null);
    setPendingApproval(null);
    setPendingQuestion(null);
    setIncompleteRun(null);
    setQueueHalted(false);
    const result = await window.electronAPI.runTask(item.task, item.connectorId);
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
      setQueueHalted(true);
    }
  }

  function handleAddToQueue() {
    if (!task.trim() || !connectorId) return;
    setQueue((prev) => [...prev, { task: task.trim(), connectorId }]);
    setTask("");
  }

  function handleRemoveFromQueue(index: number) {
    setQueue((prev) => prev.filter((_, i) => i !== index));
  }

  function handleClearQueue() {
    setQueue([]);
    setQueueHalted(false);
  }

  // מריץ אוטומטית את הפעולה הבאה בתור, אבל רק אם הריצה הקודמת הסתיימה נקי
  // ("done") - כל סטטוס סיום אחר (שגיאה/נדחה/נעצר/הגיע למקסימום צעדים) עוצר
  // את התור לבדיקה ידנית, כדי לא להמשיך "עיוור" אחרי תקלה.
  useEffect(() => {
    if (running || queueHalted || queue.length === 0 || !window.electronAPI) return;
    const [next, ...rest] = queue;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- מדלג את התור לפני הרצת הפריט הבא, לא רק סנכרון תצוגה
    setQueue(rest);
    void startQueuedTask(next);
  }, [running, queueHalted, queue]);

  async function handleResume() {
    if (!window.electronAPI || !incompleteRun || !connectorId) return;
    setLog([]);
    setLatestScreenshot(null);
    setPendingApproval(null);
    setPendingQuestion(null);
    setTask(incompleteRun.task);
    const result = await window.electronAPI.runTask(incompleteRun.task, connectorId, incompleteRun.id);
    setIncompleteRun(null);
    if (result.started) setRunning(true);
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

  async function handleAnswerSubmit() {
    if (!window.electronAPI || !answerInput.trim()) return;
    const answer = answerInput.trim();
    setAnswerInput("");
    setPendingQuestion(null);
    setLog((prev) => [...prev, { step: 0, kind: "status", text: `התשובה שלך: ${answer}` }]);
    await window.electronAPI.answerQuestion(answer);
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
      <div className="flex items-baseline justify-between gap-2">
        <h1 className="text-2xl font-bold text-slate-900">AI Agent</h1>
        {appVersion && <span className="text-xs text-slate-400" dir="ltr">גרסה {appVersion}</span>}
      </div>
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

          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-500" htmlFor="connector-select">
              עבור איזו תוכנה המשימה?
            </label>
            <select
              id="connector-select"
              value={connectorId}
              onChange={(e) => setConnectorId(e.target.value)}
              disabled={running}
              className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
            >
              {CONNECTORS.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            {learnedScreenCount > 0 && (
              <span className="text-xs text-slate-400">
                {learnedScreenCount} מסכים מוכרים בתוכנה הזו מריצות קודמות
              </span>
            )}
          </div>

          {incompleteRun && !running && (
            <div className="rounded-xl border border-amber-300 bg-amber-50 p-5">
              <h2 className="font-semibold text-amber-900">נמצאה ריצה שלא הושלמה</h2>
              <p className="mt-1 text-sm text-amber-900">
                &quot;{incompleteRun.task}&quot; - {incompleteRun.steps.length} צעדים בוצעו לפני שהאפליקציה
                נסגרה. אפשר להמשיך מאותה נקודה, בלי להתחיל מחדש ובלי לחזור על פעולות שכבר בוצעו.
              </p>
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  onClick={handleResume}
                  className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
                >
                  המשך מאותה נקודה
                </button>
                <button
                  type="button"
                  onClick={() => setIncompleteRun(null)}
                  className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  התעלם
                </button>
              </div>
            </div>
          )}

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
              disabled={running || !task.trim() || !connectorId}
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
            <button
              type="button"
              onClick={handleAddToQueue}
              disabled={!task.trim() || !connectorId}
              className="rounded-lg border border-slate-300 px-5 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              הוסף לתור
            </button>
          </div>

          {queue.length > 0 && (
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-slate-800">
                  תור משימות ({queue.length}) - ירוצו אוטומטית אחת אחרי השנייה
                </h2>
                <button type="button" onClick={handleClearQueue} className="text-xs text-red-600 underline">
                  נקה תור
                </button>
              </div>
              <ol className="mt-2 flex flex-col gap-1 text-sm">
                {queue.map((item, i) => (
                  <li key={i} className="flex items-center justify-between gap-2 text-slate-600">
                    <span className="truncate">
                      {i + 1}. [{CONNECTORS.find((c) => c.id === item.connectorId)?.name ?? item.connectorId}]{" "}
                      {item.task}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleRemoveFromQueue(i)}
                      className="shrink-0 text-xs text-red-600 underline"
                    >
                      הסר
                    </button>
                  </li>
                ))}
              </ol>
              {queueHalted && (
                <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                  התור הושהה - הריצה האחרונה לא הסתיימה בהצלחה. בדוק/י את הפלט למעלה, ואז אפשר להמשיך.
                  <button
                    type="button"
                    onClick={() => setQueueHalted(false)}
                    className="mr-2 font-medium text-indigo-700 underline"
                  >
                    המשך תור
                  </button>
                </div>
              )}
            </div>
          )}

          {pendingApproval && (
            <div className="rounded-xl border border-amber-300 bg-amber-50 p-5">
              <div className="flex items-center justify-between gap-2">
                <h2 className="font-semibold text-amber-900">נדרש אישור לפני ביצוע</h2>
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                    pendingApproval.confidence < CONFIDENCE_WARNING_THRESHOLD
                      ? "bg-red-100 text-red-700"
                      : "bg-emerald-100 text-emerald-700"
                  }`}
                >
                  ביטחון {Math.round(pendingApproval.confidence * 100)}%
                  {pendingApproval.confidence < CONFIDENCE_WARNING_THRESHOLD && " - נמוך, בדוק היטב"}
                </span>
              </div>
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

          {pendingQuestion && (
            <div className="rounded-xl border border-indigo-300 bg-indigo-50 p-5">
              <h2 className="font-semibold text-indigo-900">ה-AI זקוק לתשובה כדי להמשיך</h2>
              <p className="mt-1 text-sm text-indigo-900">{pendingQuestion.question}</p>
              <div className="mt-3 flex gap-2">
                <input
                  type="text"
                  value={answerInput}
                  onChange={(e) => setAnswerInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleAnswerSubmit()}
                  placeholder="הקלד/י תשובה..."
                  className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm"
                />
                <button
                  type="button"
                  onClick={handleAnswerSubmit}
                  disabled={!answerInput.trim()}
                  className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
                >
                  שלח תשובה
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

          <RunHistory refreshSignal={historyRefresh} />
        </div>
      )}
    </main>
  );
}
