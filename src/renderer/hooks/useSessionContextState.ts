import { useCallback, useState } from 'react';
import { SessionContextState } from '../types';

function createDefaultSessionContext(): SessionContextState {
  return {
    activeAgentId: null,
    activeSessionId: null,
    confirmationRequest: null,
    latestContextSummary: null,
    latestRun: null,
    activeRunSteps: []
  };
}

export function useSessionContextState() {
  const [sessionContext, setSessionContext] = useState<SessionContextState>(createDefaultSessionContext);

  const updateSessionContext = useCallback((patch: Partial<SessionContextState>) => {
    setSessionContext((current) => ({
      ...current,
      ...patch
    }));
  }, []);

  return {
    sessionContext,
    updateSessionContext
  };
}
