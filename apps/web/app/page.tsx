import Link from "next/link";

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col items-center justify-center gap-6 px-6 py-24 text-center">
      <h1 className="text-3xl font-bold text-slate-900">Accountant AI Operator</h1>
      <p className="max-w-xl text-slate-600">
        גרסה ראשונה (v1): חיבור לתוכנות חשבונאות דרך כפתור אחד - קישור לדפדפן לתוכנות Web,
        או הפעלה מקומית לתוכנות שמותקנות על המחשב.
      </p>
      <Link
        href="/integrations"
        className="rounded-lg bg-indigo-600 px-6 py-3 text-sm font-medium text-white hover:bg-indigo-700"
      >
        למרכז האינטגרציות
      </Link>
    </main>
  );
}
