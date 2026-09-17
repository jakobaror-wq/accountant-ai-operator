import type { Metadata } from "next";
import { Heebo } from "next/font/google";
import "./globals.css";
import { createClient } from "@/lib/supabase/server";

const heebo = Heebo({
  variable: "--font-heebo",
  subsets: ["hebrew", "latin"],
});

export const metadata: Metadata = {
  title: "Accountant AI Operator",
  description: "סוכן AI שמפעיל תוכנות חשבונאות קיימות ומגיש חבילת אישור לרו\"ח",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <html lang="he" dir="rtl" className={`${heebo.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col bg-slate-50 text-slate-900 font-sans">
        {user && (
          <header className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-3">
            <span className="text-sm font-semibold text-slate-900">Accountant AI Operator</span>
            <div className="flex items-center gap-3 text-sm text-slate-500">
              <span dir="ltr">{user.email}</span>
              <form action="/auth/signout" method="post">
                <button type="submit" className="text-indigo-600 hover:underline">
                  יציאה
                </button>
              </form>
            </div>
          </header>
        )}
        {children}
      </body>
    </html>
  );
}
