"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface Props {
  refreshSignal: number;
}

export function RunHistory({ refreshSignal }: Props) {
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    if (!window.electronAPI) return;
    window.electronAPI.listRuns().then((runs) => setCount(runs.length));
  }, [refreshSignal]);

  return (
    <div className="mt-8 border-t border-slate-200 pt-6 text-sm">
      <Link href="/audit" className="font-medium text-indigo-600 underline">
        יומן ביקורת מלא {count !== null && count > 0 ? `(${count} ריצות)` : ""}
      </Link>
    </div>
  );
}
