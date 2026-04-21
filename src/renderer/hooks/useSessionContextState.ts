import { useCallback, useState } from 'react';
import { SessionContextState, SessionContextUpdate } from '../types';

function createDefaultSessionContext(): SessionContextState {
  return {
    activeAgentId: null,
    activeSessionId: null,
    appNotice: null,
    confirmationRequest: null,
    latestContextSummary: null,
    latestRun: null,
    activeRunSteps: []
  };
}

export function useSessionContextState() {
  const [sessionContext, setSessionContext] = useState<SessionContextState>(createDefaultSessionContext);

  const updateSessionContext = useCallback((patch: SessionContextUpdate) => {
    setSessionContext((current) => {
      const nextPatch = typeof patch === 'function' ? patch(current) : patch;
      return {
        ...current,
        ...nextPatch
      };
    });
  }, []);

  return {
    sessionContext,
    updateSessionContext
  };
}
