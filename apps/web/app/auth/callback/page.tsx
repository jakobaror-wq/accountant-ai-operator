"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

function CallbackHandler() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [status, setStatus] = useState<"working" | "error">("working");
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    const next = searchParams.get("next") ?? "/integrations";

    // Supabase מוסיף פרטי שגיאה (קישור פג תוקף/כבר נוצל וכו') ל-hash, לא ל-query.
    const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const hashError = hashParams.get("error_description") || hashParams.get("error");
    if (hashError) {
      // window.location.hash לא קיים ב-SSR - קריאה חד-פעמית בעת ה-mount בלבד.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setStatus("error");
      setErrorMessage(decodeURIComponent(hashError));
      return;
    }

    const supabase = createClient();

    supabase.auth.getSession().then(({ data, error }) => {
      if (error) {
        setStatus("error");
        setErrorMessage(error.message);
        return;
      }
      if (data.session) {
        router.replace(next);
      }
    });

    const { data: subscription } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_IN" && session) {
        router.replace(next);
      }
    });

    const timeout = setTimeout(() => {
      setStatus((current) => {
        if (current === "working") {
          setErrorMessage("לא הצלחנו לאשר את ההתחברות. נסה/י לבקש קישור חדש.");
          return "error";
        }
        return current;
      });
    }, 8000);

    return () => {
      subscription.subscription.unsubscribe();
      clearTimeout(timeout);
    };
  }, [router, searchParams]);

  if (status === "error") {
    return (
      <div className="text-center">
        <p className="text-sm text-red-600">{errorMessage}</p>
        <a href="/login" className="mt-4 inline-block text-sm text-indigo-600 underline">
          חזרה למסך התחברות
        </a>
      </div>
    );
  }

  return <p className="text-sm text-slate-500">מתחבר...</p>;
}

export default function AuthCallbackPage() {
  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col items-center justify-center gap-4 px-6 py-24">
      <Suspense fallback={<p className="text-sm text-slate-500">מתחבר...</p>}>
        <CallbackHandler />
      </Suspense>
    </main>
  );
}
