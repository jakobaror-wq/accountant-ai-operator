import { IntegrationsGrid } from "@/components/IntegrationsGrid";
import { InstallAppBanner } from "@/components/InstallAppBanner";

export const metadata = {
  title: "מרכז אינטגרציות | Accountant AI Operator",
};

export default function IntegrationsPage() {
  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-10">
      <InstallAppBanner />
      <header className="mb-8">
        <h1 className="text-2xl font-bold text-slate-900">מרכז אינטגרציות</h1>
        <p className="mt-2 max-w-2xl text-sm text-slate-600">
          החיבור לכל תוכנה הוא לוקאלי בלבד - בוחרים פעם אחת את קובץ ההפעלה שלה על המחשב הזה,
          והמערכת זוכרת אותו לצמיתות. אין קישורי אינטרנט וללא צורך בהגדרה חוזרת.
        </p>
      </header>

      <IntegrationsGrid />
    </main>
  );
}
