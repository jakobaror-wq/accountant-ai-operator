import { CONNECTORS } from "@/lib/connectors";
import { ConnectorCard } from "@/components/ConnectorCard";

export const metadata = {
  title: "מרכז אינטגרציות | Accountant AI Operator",
};

export default function IntegrationsPage() {
  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-10">
      <header className="mb-8">
        <h1 className="text-2xl font-bold text-slate-900">מרכז אינטגרציות</h1>
        <p className="mt-2 max-w-2xl text-sm text-slate-600">
          לכל תוכנת חשבונאות יש שתי דרכי חיבור אפשריות: אם יש לה כתובת אינטרנט להתחברות -
          בחרו &quot;דרך דפדפן&quot; והדביקו את הקישור. אם זו תוכנה שמותקנת רק על המחשב - בחרו
          &quot;מותקן על המחשב&quot; והתקינו את ה-Local Launcher פעם אחת (ר&apos; מדריך ההתקנה).
        </p>
      </header>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        {CONNECTORS.map((connector) => (
          <ConnectorCard key={connector.id} connector={connector} />
        ))}
      </div>
    </main>
  );
}
