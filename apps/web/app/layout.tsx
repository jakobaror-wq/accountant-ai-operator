import type { Metadata } from "next";
import { Heebo } from "next/font/google";
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
        <header className="border-b border-slate-200 bg-white px-6 py-3">
          <span className="text-sm font-semibold text-slate-900">Accountant AI Operator</span>
        </header>
        {children}
      </body>
    </html>
  );
}
