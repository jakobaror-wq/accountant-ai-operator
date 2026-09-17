"use client";

import { createClient } from "./supabase/client";
import type { ConnectionType } from "./connectors";

export interface ConnectorConfig {
  type: ConnectionType | null;
  url?: string;
}

export async function saveConnectorConfig(
  officeId: string,
  connectorId: string,
  config: ConnectorConfig,
): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.from("connector_configs").upsert(
    {
      office_id: officeId,
      connector_id: connectorId,
      connection_type: config.type,
      url: config.url ?? null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "office_id,connector_id" },
  );
  if (error) throw error;
}
