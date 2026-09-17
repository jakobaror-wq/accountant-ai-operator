import { CONNECTORS } from "@/lib/connectors";
import { ConnectorCard } from "@/components/ConnectorCard";
import { getSupabase } from "@/lib/supabase";
import { DEFAULT_OFFICE_ID } from "@/lib/default-office";
import type { ConnectorConfig } from "@/lib/connector-configs-client";

export const metadata = {
  title: "מרכז אינטגרציות | Accountant AI Operator",
};

// חובה - הדף קורא מ-Supabase בכל טעינה; בלי זה Next יקפיא אותו כ-snapshot
// סטטי מזמן ה-build ולא ישקף עדכונים שנשמרו לאחר מכן.
export const dynamic = "force-dynamic";

export default async function IntegrationsPage() {
  const supabase = getSupabase();
  const { data } = await supabase
    .from("connector_configs")
    .select("connector_id, connection_type, url")
    .eq("office_id", DEFAULT_OFFICE_ID);

  const configByConnectorId = new Map<string, ConnectorConfig>(
    (data ?? []).map((row) => [
      row.connector_id,
      { type: row.connection_type as ConnectorConfig["type"], url: row.url ?? undefined },
    ]),
  );

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-10">
      <header className="mb-8">
        <h1 className="text-2xl font-bold text-slate-900">מרכז אינטגרציות</h1>
        <p className="mt-2 max-w-2xl text-sm text-slate-600">
          לכל תוכנת חשבונאות יש שתי דרכי חיבור אפשריות: אם יש לה כתובת אינטרנט להתחברות - בחרו
          &quot;דרך דפדפן&quot; והדביקו את הקישור. אם זו תוכנה שמותקנת רק על המחשב - בחרו
          &quot;מותקן על המחשב&quot; (דורש את אפליקציית שולחן העבודה).
        </p>
      </header>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        {CONNECTORS.map((connector) => (
          <ConnectorCard
            key={connector.id}
            connector={connector}
            officeId={DEFAULT_OFFICE_ID}
            initialConfig={configByConnectorId.get(connector.id) ?? { type: null }}
          />
        ))}
      </div>
    </main>
  );
}
