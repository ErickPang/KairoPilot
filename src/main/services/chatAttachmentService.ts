import {
  registerPreparedAttachments,
  isStoredAttachmentReferenced,
  getSessionById
} from '../store/chat';
import {
  deleteAttachmentFile,
  getWorkspaceAttachmentUploadsRoot,
  prepareChatAttachments,
  scheduleAttachmentCleanup
} from '../store/attachments';
import { addAuditLog } from '../store/audit';
import { getWorkbenchConfig } from './workbenchConfigService';
import type { ChatAttachment, PrepareAttachmentInput } from '../../shared/contracts';

export const ACTIVE_AGENT_ATTACHMENT_ERROR = 'Session does not belong to the active agent.';
export const ACTIVE_SESSION_ATTACHMENT_ERROR = 'Attachment does not belong to the active session.';
export const ACTIVE_AGENT_WORKSPACE_ERROR = 'Workbench storage is not configured.';

function getSessionForActiveAgent(sessionId: string) {
  const session = getSessionById(sessionId);
  if (!session) return null;
  return session;
}

export async function getTaskSession(sessionId: string) { return getSessionForActiveAgent(sessionId); }

export async function prepareAttachmentsForActiveAgent(params: {
  sessionId: string;
  files: PrepareAttachmentInput[];
}) {
  const session = getSessionForActiveAgent(params.sessionId);
  if (!session) {
    throw new Error(ACTIVE_AGENT_ATTACHMENT_ERROR);
  }

  const agent = {workspace:getWorkbenchConfig().managementRoot};
  if (!agent?.workspace) {
    throw new Error(ACTIVE_AGENT_WORKSPACE_ERROR);
  }

  const uploadRoot = getWorkspaceAttachmentUploadsRoot(agent.workspace);
  const attachments = await prepareChatAttachments({
    sessionId: session.id,
    workspace: agent.workspace,
    files: params.files
  });
  registerPreparedAttachments(session.id, attachments);
  const cleanup = scheduleAttachmentCleanup(agent.workspace, isStoredAttachmentReferenced);

  addAuditLog({
    tool: 'prepare_attachments',
    args: {
      sessionId: session.id,
      count: attachments.length,
      files: attachments.map((attachment) => ({
        id: attachment.id,
        name: attachment.name,
        mimeType: attachment.mimeType,
        size: attachment.size,
        kind: attachment.kind,
        storedPath: attachment.storedPath
      }))
    },
    result: {
      success: true,
      uploadRoot,
      cleanup
    },
    sessionId: session.id,
    policyTags: ['attachment:prepare', 'filesystem:copy']
  });

  return attachments;
}

export function recordPrepareAttachmentsFailure(error: string) {
  addAuditLog({
    tool: 'prepare_attachments',
    args: {},
    error,
    policyTags: ['attachment:prepare', 'decision:error']
  });
}

export async function deleteAttachmentForActiveSession(params: {
  sessionId: string;
  attachment: ChatAttachment;
}) {
  const session = getSessionForActiveAgent(params.sessionId);
  if (!session || params.attachment.sessionId !== session.id) {
    throw new Error(ACTIVE_SESSION_ATTACHMENT_ERROR);
  }

  const deleted = await deleteAttachmentFile(params.attachment);
  addAuditLog({
    tool: 'delete_attachment',
    args: {
      sessionId: params.sessionId,
      attachmentId: params.attachment.id,
      name: params.attachment.name
    },
    result: { deleted },
    sessionId: params.sessionId,
    policyTags: ['attachment:delete']
  });
  return deleted;
}
