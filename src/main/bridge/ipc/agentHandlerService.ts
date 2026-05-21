import type { WebContents } from 'electron';
import { ensureAgentRuntime, getAgentRuntime, resolveAgentConfig } from '../../assistant/agentRuntime';
import { KAIRO_EVENT } from '../../../shared/ipc';
import { getActiveAgentId } from '../../store/config';
import { ensureActiveSession, getApprovalRecord, getRunById, updateSessionMessages } from '../../store/chat';
import type { ChatMessage } from '../../core/llm/types';
import type { RuntimeExecutionResult, RuntimeUpdate } from '../../core/agent/runEngine';
import type { AgentChatRequest, AgentRuntimeInvokeResult, ChatAttachment } from '../../../shared/contracts';

const DEFAULT_INIT_ERROR = 'Agent not initialized. Please configure settings first.';

export async function resolveRuntimeForRun(runId: string, sender: WebContents) {
  const run = getRunById(runId);
  if (!run) {
    throw new Error(`Run not found: ${runId}`);
  }

  let agent = getAgentRuntime(run.agentId);
  if (agent) {
    return { agent, run };
  }

  const config = await resolveAgentConfig(run.agentId);
  agent = await ensureAgentRuntime(config, sender);
  if (!agent) {
    throw new Error('Agent initialization failed.');
  }

  return { agent, run };
}

export async function ensureActiveAgentRuntime(sender: WebContents) {
  const activeAgentId = getActiveAgentId();
  if (!activeAgentId) {
    throw new Error(DEFAULT_INIT_ERROR);
  }

  let agent = getAgentRuntime(activeAgentId);
  const config = await resolveAgentConfig(activeAgentId);
  agent = await ensureAgentRuntime(config, sender);
  if (!agent) {
    throw new Error('Agent initialization failed.');
  }

  return { activeAgentId, agent };
}

export async function resolveRuntimeForApproval(approvalId: string, sender: WebContents) {
  const approval = getApprovalRecord(approvalId);
  if (!approval) {
    throw new Error(`Approval record not found: ${approvalId}`);
  }

  const { agent, run } = await resolveRuntimeForRun(approval.runId, sender);
  return {
    agent,
    run,
    approval
  };
}

export function createRuntimeUpdateForwarder(sender: WebContents, sessionId?: string | null) {
  return (update: RuntimeUpdate) => {
    sender.send(KAIRO_EVENT.agentUpdate, update.type === 'approval-required'
      ? {
          ...update,
          sessionId: sessionId || update.sessionId
        }
      : update);
  };
}

export function persistAgentSessionHistory(agent: { getSessionHistory: () => ChatMessage[] }, sessionId?: string | null) {
  if (sessionId) {
    updateSessionMessages(sessionId, agent.getSessionHistory());
  }
}

export function mapRuntimeExecutionResult(result: RuntimeExecutionResult): AgentRuntimeInvokeResult {
  return {
    success: result.status !== 'failed' && !result.error,
    content: result.content,
    error: result.error,
    status: result.status,
    runId: result.runId,
    approvalId: result.approvalId
  };
}

export function mapUnknownError(error: unknown, fallback = 'Unknown error') {
  return error instanceof Error ? error.message : fallback;
}

function normalizeAgentChatRequest(input: unknown): AgentChatRequest {
  if (typeof input === 'string') {
    return { content: input };
  }

  if (!input || typeof input !== 'object') {
    return { content: '' };
  }

  const payload = input as Record<string, unknown>;
  const content = typeof payload.content === 'string' ? payload.content : '';
  const attachments = Array.isArray(payload.attachments)
    ? payload.attachments.filter((item): item is ChatAttachment => {
        if (!item || typeof item !== 'object') {
          return false;
        }
        const attachment = item as Record<string, unknown>;
        return typeof attachment.id === 'string'
          && typeof attachment.sessionId === 'string'
          && typeof attachment.storedPath === 'string';
      })
    : undefined;
  return { content, attachments };
}

export async function runActiveAgentChat(input: unknown, sender: WebContents) {
  const request = normalizeAgentChatRequest(input);
  const { activeAgentId, agent } = await ensureActiveAgentRuntime(sender);
  const session = ensureActiveSession(activeAgentId);

  if (!session) {
    throw new Error('Failed to resolve active session.');
  }

  agent.setHistory(session.messages);
  try {
    const response = await agent.chat(
      request.content,
      createRuntimeUpdateForwarder(sender, session.id),
      { sessionId: session.id, agentId: activeAgentId, attachments: request.attachments }
    );

    return mapRuntimeExecutionResult(response);
  } finally {
    persistAgentSessionHistory(agent, session.id);
  }
}
