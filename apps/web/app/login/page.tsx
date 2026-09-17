"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

function LoginForm() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const searchParams = useSearchParams();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("sending");
    setErrorMessage("");

    const supabase = createClient();
    const next = searchParams.get("next") ?? "/integrations";
    const redirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`;

    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: redirectTo },
    });

    if (error) {
      setStatus("error");
      setErrorMessage(error.message);
    } else {
      setStatus("sent");
    }
  }

  if (status === "sent") {
    return (
      <p className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-center text-sm text-emerald-800">
        נשלח קישור התחברות ל-{email}. פתח/י אותו כדי להיכנס.
      </p>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <input
        type="email"
        required
        placeholder="you@office.co.il"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        dir="ltr"
        className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-left"
      />
      <button
        type="submit"
        disabled={status === "sending"}
        className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
      >
        {status === "sending" ? "שולח..." : "שלח קישור התחברות"}
      </button>
      {status === "error" && <p className="text-sm text-red-600">{errorMessage}</p>}
    </form>
  );
}

export default function LoginPage() {
  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-6 px-6 py-24">
      <div className="text-center">
        <h1 className="text-2xl font-bold text-slate-900">התחברות</h1>
        <p className="mt-2 text-sm text-slate-600">
          Accountant AI Operator - נשלח לך קישור התחברות למייל, בלי סיסמה.
        </p>
      </div>
      <Suspense fallback={null}>
        <LoginForm />
      </Suspense>
    </main>
  );
}
