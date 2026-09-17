import type { Metadata } from "next";
import { Heebo } from "next/font/google";
import Link from "next/link";
import "./globals.css";

const heebo = Heebo({
  variable: "--font-heebo",
  subsets: ["hebrew", "latin"],
});

export const metadata: Metadata = {
  title: "Accountant AI Operator",
  description: "סוכן AI שמפעיל תוכנות חשבונאות קיימות ומגיש חבילת אישור לרו\"ח",
  icons: {
    icon: "/icon-512.png",
    apple: "/apple-touch-icon.png",
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="he" dir="rtl" className={`${heebo.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col bg-slate-50 text-slate-900 font-sans">
        <header className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-3">
          <span className="text-sm font-semibold text-slate-900">Accountant AI Operator</span>
          <nav className="flex gap-4 text-sm text-slate-600">
            <Link href="/integrations" className="hover:text-indigo-600">
              אינטגרציות
            </Link>
            <Link href="/agent" className="hover:text-indigo-600">
              AI Agent
            </Link>
            <Link href="/audit" className="hover:text-indigo-600">
              יומן ביקורת
            </Link>
          </nav>
        </header>
        {children}
      </body>
    </html>
  );
}
