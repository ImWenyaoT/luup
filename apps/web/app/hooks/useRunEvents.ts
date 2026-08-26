import { useEffect, useRef, useState } from "react";

import { TERMINAL_STATUSES } from "../lib/types/constants";
import type { Snapshot } from "../lib/types/wire";
import { subscribeRunEvents } from "../lib/sse/subscribe";

export function useRunEvents(
  runId: string | null,
  snapshot: Snapshot | null,
  onTick: () => void,
): { connected: boolean } {
  const [connected, setConnected] = useState(false);
  const onTickRef = useRef(onTick);
  onTickRef.current = onTick;

  useEffect(() => {
    if (!runId || !snapshot) {
      setConnected(false);
      return;
    }
    if (TERMINAL_STATUSES.has(snapshot.status)) {
      setConnected(false);
      return;
    }

    setConnected(true);
    const subscription = subscribeRunEvents(runId, snapshot.version, () => {
      onTickRef.current();
    });

    return () => {
      subscription.close();
      setConnected(false);
    };
  }, [runId, snapshot?.version, snapshot?.status]);

  return { connected };
}
