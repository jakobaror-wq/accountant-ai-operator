"use client";

import { useEffect, useState } from "react";
import { CONNECTORS } from "@/lib/connectors";
import { ConnectorCard } from "@/components/ConnectorCard";

export function IntegrationsGrid() {
  const [paths, setPaths] = useState<Record<string, string>>({});

  useEffect(() => {
    if (typeof window === "undefined" || !window.electronAPI) return;
    window.electronAPI.getConnectorPaths().then(setPaths);
  }, []);

  return (
    <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
      {CONNECTORS.map((connector) => (
        <ConnectorCard key={connector.id} connector={connector} path={paths[connector.id] ?? null} />
      ))}
    </div>
  );
}
