import { useCallback, useState } from 'react';
import { SessionContextState } from '../types';

function createDefaultSessionContext(): SessionContextState {
  return {
    activeAgentId: null,
    activeSessionId: null,
    confirmationRequest: null
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
