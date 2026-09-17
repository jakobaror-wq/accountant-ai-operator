export const metadata = {
  title: "התקנת Local Launcher | Accountant AI Operator",
};

const files = [
  { href: "/local-launcher/install.ps1", label: "install.ps1" },
  { href: "/local-launcher/launcher.ps1", label: "launcher.ps1" },
  { href: "/local-launcher/uninstall.ps1", label: "uninstall.ps1" },
  { href: "/local-launcher/config.example.json", label: "config.example.json" },
];

export default function LocalLauncherPage() {
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-10">
      <h1 className="text-2xl font-bold text-slate-900">התקנת Local Launcher (Windows)</h1>
      <p className="mt-3 text-sm text-slate-600">
        זהו רכיב v1 מינימלי: הוא <strong>רק פותח</strong> תוכנה מותקנת אצלכם כשלוחצים על כפתור
        באתר - הוא לא קורא נתונים ולא מזין כלום בתוכנה. זו ההתחלה של ה-Local Agent המתוכנן
        (ר&apos; docs/01-ARCHITECTURE.md), שיקבל בהמשך יכולות קריאה/מילוי טפסים דרך Computer Use.
      </p>

      <ol className="mt-6 flex flex-col gap-4 text-sm text-slate-700">
        <li>
          <strong>1. הורידו את הקבצים הבאים לתיקייה ייעודית</strong> (למשל{" "}
          <code dir="ltr">C:\AccountantAIOperator\local-launcher</code>):
          <ul className="mt-2 flex flex-col gap-1">
            {files.map((f) => (
              <li key={f.href}>
                <a href={f.href} download className="text-indigo-600 underline" dir="ltr">
                  {f.label}
                </a>
              </li>
            ))}
          </ul>
        </li>
        <li>
          <strong>2. הריצו את install.ps1</strong> (קליק ימני → Run with PowerShell). זה ירשום
          קישורים מסוג <code dir="ltr">accountant-ai-operator://</code> אצל המשתמש הנוכחי בלבד -
          לא דורש הרשאות Administrator, ולא נוגע במשתמשים אחרים במחשב.
        </li>
        <li>
          <strong>3. ערכו את config.json</strong> שנוצר באותה תיקייה, והחליפו כל נתיב לנתיב
          האמיתי של הקובץ המריץ (.exe) של כל תוכנה אצלכם. הכפתור באתר{" "}
          <strong>לעולם לא</strong> שולח נתיב - הוא רק שולח את שם התוכנה, וה-Launcher בודק מול
          הרשימה המקומית הזו בלבד לפני שהוא מפעיל משהו.
        </li>
        <li>
          <strong>4. חזרו למרכז האינטגרציות</strong> ולחצו &quot;פתח את [שם התוכנה]&quot;. אם
          הדפדפן שואל &quot;לפתוח את accountant-ai-operator://?&quot; - אשרו (פעם ראשונה בלבד
          לרוב הדפדפנים).
        </li>
      </ol>

      <div className="mt-8 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        אם התוכנה לא נפתחת: ודאו שה-install.ps1 רץ בהצלחה, שה-config.json מכיל נתיב תקין וקיים
        בפועל, ובדקו את launcher.log שנוצר באותה תיקייה לפרטי השגיאה המדויקים.
      </div>
    </main>
  );
}
