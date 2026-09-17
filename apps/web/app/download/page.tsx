import { DESKTOP_APP_DOWNLOAD_URL } from "@/lib/desktop-app";

export const metadata = {
  title: "הורדת אפליקציית שולחן העבודה | Accountant AI Operator",
};

export default function DownloadPage() {
  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-10">
      <h1 className="text-2xl font-bold text-slate-900">אפליקציית שולחן העבודה</h1>
      <p className="mt-3 text-sm text-slate-600">
        כדי לפתוח תוכנות חשבונאות שמותקנות אצלכם על המחשב (לא דרך דפדפן), מתקינים פעם אחת
        אפליקציה קטנה שיושבת על שולחן העבודה עם קיצור דרך משלה. היא פותחת בתוכה את אותו אתר -
        רק עם שתי יכולות נוספות: בחירת קובץ ההפעלה של כל תוכנה בלחיצת כפתור, והפעלה שלה.
      </p>

      <a
        href={DESKTOP_APP_DOWNLOAD_URL}
        className="mt-6 inline-flex items-center justify-center rounded-lg bg-indigo-600 px-6 py-3 text-sm font-medium text-white hover:bg-indigo-700"
      >
        להורדת ההתקנה (Windows)
      </a>

      <ol className="mt-8 flex flex-col gap-3 text-sm text-slate-700">
        <li>
          <strong>1.</strong> לוחצים על הכפתור למעלה - קובץ ה-<code dir="ltr">.exe</code> העדכני
          ביותר יורד ישירות.
        </li>
        <li>
          <strong>2.</strong> מריצים את קובץ ההתקנה - זה יוצר קיצור דרך על שולחן העבודה עם הלוגו
          של האפליקציה.
        </li>
        <li>
          <strong>3.</strong> פותחים את האפליקציה, נכנסים למרכז האינטגרציות, ולכל תוכנה שמותקנת
          אצלכם לוחצים &quot;בחר תוכנה&quot; פעם אחת - נפתחת תיקייה, מסמנים את קובץ ה-.exe, וזהו.
          מאז אפשר פשוט ללחוץ &quot;פתח את [שם התוכנה]&quot;.
        </li>
      </ol>

      <p className="mt-8 rounded-lg border border-slate-200 bg-white p-4 text-xs text-slate-500">
        הבחירה נשמרת רק על המחשב הזה, בתוך האפליקציה - לא נשלחת לענן. אם עובדים מכמה מחשבים, יש
        לבחור את הקובץ פעם אחת בכל מחשב.
      </p>
    </main>
  );
}
