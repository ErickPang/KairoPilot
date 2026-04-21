import type { LoadedSkillCapability } from './capabilityOrchestrator';
import {
  computeActiveSkillsUpdate,
  computeSkillCatalogUpdate,
  computeToolCatalogUpdate,
  createActiveSkillsSnapshot,
  createToolCatalogSnapshot,
  SessionActiveSkillState,
  RuntimeSupportSnapshot,
  SessionSkillCatalogState,
  SessionToolCatalogState,
  SkillCatalogSnapshot
} from './runtimeHelpers';

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => String(item).trim())
    .filter(Boolean);
}

export class RuntimeSupportState {
  private sessionActiveSkillStates = new Map<string, SessionActiveSkillState>();
  private sessionSkillCatalogStates = new Map<string, SessionSkillCatalogState>();
  private sessionToolCatalogStates = new Map<string, SessionToolCatalogState>();

  restore(snapshot?: RuntimeSupportSnapshot) {
    this.sessionActiveSkillStates.clear();
    this.sessionSkillCatalogStates.clear();
    this.sessionToolCatalogStates.clear();

    const activeSkillSessions = snapshot?.activeSkillSessions;
    if (activeSkillSessions) {
      for (const [key, value] of Object.entries(activeSkillSessions)) {
        if (!value || typeof value.fingerprint !== 'string') {
          continue;
        }

        this.sessionActiveSkillStates.set(key, {
          fingerprint: value.fingerprint,
          announcedSkillNames: normalizeStringArray(value.announcedSkillNames)
        });
      }
    }

    const skillCatalogSessions = snapshot?.skillCatalogSessions;
    if (skillCatalogSessions) {
      for (const [key, value] of Object.entries(skillCatalogSessions)) {
        if (!value || typeof value.fingerprint !== 'string') {
          continue;
        }

        this.sessionSkillCatalogStates.set(key, {
          fingerprint: value.fingerprint,
          announcedSkillIds: normalizeStringArray(value.announcedSkillIds)
        });
      }
    }

    const toolCatalogSessions = snapshot?.toolCatalogSessions;
    if (!toolCatalogSessions) {
      return;
    }

    for (const [key, value] of Object.entries(toolCatalogSessions)) {
      if (!value || typeof value.fingerprint !== 'string') {
        continue;
      }

      this.sessionToolCatalogStates.set(key, {
        fingerprint: value.fingerprint,
        announcedToolNames: normalizeStringArray(value.announcedToolNames)
      });
    }
  }

  snapshot(): RuntimeSupportSnapshot | undefined {
    if (
      this.sessionActiveSkillStates.size === 0
      && this.sessionSkillCatalogStates.size === 0
      && this.sessionToolCatalogStates.size === 0
    ) {
      return undefined;
    }

    return {
      activeSkillSessions: Object.fromEntries(this.sessionActiveSkillStates.entries()),
      skillCatalogSessions: Object.fromEntries(this.sessionSkillCatalogStates.entries()),
      toolCatalogSessions: Object.fromEntries(this.sessionToolCatalogStates.entries())
    };
  }

  resolveAvailableSkillsSummary(
    runId: string,
    sessionId: string | undefined,
    availableSkillsCatalog: SkillCatalogSnapshot | undefined,
    consumeRuntimeSupportSummary: boolean
  ) {
    const sessionKey = this.getSessionKey(runId, sessionId);
    const currentState = this.sessionSkillCatalogStates.get(sessionKey);
    const update = computeSkillCatalogUpdate(availableSkillsCatalog, currentState);
    if (consumeRuntimeSupportSummary && update.nextState) {
      this.sessionSkillCatalogStates.set(sessionKey, update.nextState);
    }
    return update.summary;
  }

  resolveActiveSkillsSummary(
    runId: string,
    sessionId: string | undefined,
    loadedSkills: LoadedSkillCapability[],
    consumeRuntimeSupportSummary: boolean
  ) {
    const sessionKey = this.getSessionKey(runId, sessionId);
    const currentState = this.sessionActiveSkillStates.get(sessionKey);
    const activeSkillSnapshot = createActiveSkillsSnapshot(loadedSkills);
    const update = computeActiveSkillsUpdate(activeSkillSnapshot, currentState);
    if (consumeRuntimeSupportSummary && update.nextState) {
      this.sessionActiveSkillStates.set(sessionKey, update.nextState);
    }
    return update.summary;
  }

  resolveAvailableToolsSummary(
    runId: string,
    sessionId: string | undefined,
    availableToolNames: string[] | undefined,
    consumeToolSummary: boolean
  ) {
    const sessionKey = this.getSessionKey(runId, sessionId);
    const currentState = this.sessionToolCatalogStates.get(sessionKey);
    const toolCatalogSnapshot = createToolCatalogSnapshot(availableToolNames || []);
    const update = computeToolCatalogUpdate(toolCatalogSnapshot, currentState);
    if (consumeToolSummary && update.nextState) {
      this.sessionToolCatalogStates.set(sessionKey, update.nextState);
    }
    return update.summary;
  }

  private getSessionKey(runId: string, sessionId?: string) {
    const normalizedSessionId = typeof sessionId === 'string' ? sessionId.trim() : '';
    return normalizedSessionId || `run:${runId}`;
  }
}
