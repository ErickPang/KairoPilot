import { getConversationPage, getConversationDetails } from '../../store/conversation';
import { updateTaskSettings } from '../../services/taskSettingsService';
import {IntelligenceBudgetSchema} from '../../../shared/intelligencePolicy';
import { getActiveSessionSummary, getSessionMessagePage, querySessionPage } from '../../store/taskPages';
import { ipcMain } from 'electron';
import { z } from 'zod';
import { KAIRO_INVOKE } from '../../../shared/ipc';
import { archiveTask, createTaskReference, getTaskDraft, readTask, saveTaskDraft } from '../../services/taskOrganizationService';

const id = z.string().min(1).max(200);
const session = z.object({ sessionId: id });
const draft = session.extend({ revision: z.number().int().nonnegative(), data: z.object({ input: z.string().max(1_000_000), referenceIds: z.array(id).max(50), attachmentIds: z.array(id).max(50) }) });

export function registerTaskOrganizationHandlers() {
  ipcMain.handle(KAIRO_INVOKE.chatConversation, (_, value) => {
    const query = session.extend({ before: z.number().int().positive().optional() }).strict().parse(value);
    return getConversationPage(query.sessionId, query.before);
  });
  ipcMain.handle(KAIRO_INVOKE.chatConversationDetails, (_, value) => {
    const query = session.extend({ itemId: id }).strict().parse(value);
    return getConversationDetails(query.sessionId, query.itemId);
  });
  ipcMain.handle(KAIRO_INVOKE.chatUpdateTaskSettings,(_,value)=> {
    const input=z.object({sessionId:id,model:z.string().min(1).max(500).optional(),executionProfile:z.enum(['chat_only','read_only_workspace','approved_execution','trusted_automation']).optional(),templateId:id.nullable().optional(),workflow:z.enum(['direct','plan']).optional(),delegation:z.enum(['off','auto','manual']).optional(),intelligenceBudget:IntelligenceBudgetSchema.optional()}).strict().parse(value);
    return updateTaskSettings(input.sessionId,input);
  });
  const cursor = z.object({ updatedAt: z.number().int().nonnegative(), id });
  ipcMain.handle(KAIRO_INVOKE.chatQuerySessions, (_, value) => {
    const query = z.object({ projectId: id.nullable().optional(), filter: z.enum(['open', 'archived', 'unread', 'all']).optional(), search: z.string().max(1000).optional(), limit: z.number().int().min(1).max(100).optional(), before: cursor.optional(), includeSessionId: id.optional(), includeActiveSession: z.boolean().optional() }).strict().parse(value || {});
    return querySessionPage(undefined,query);
  });
  ipcMain.handle(KAIRO_INVOKE.chatGetActiveSummary, () => getActiveSessionSummary(undefined));
  ipcMain.handle(KAIRO_INVOKE.chatGetMessagePage, async (_, value) => {
    const query = z.object({ sessionId: id, limit: z.number().int().min(1).max(100).optional(), before: z.object({ timestamp: z.number().int().nonnegative(), rowId: z.number().int().positive(), generation: z.number().int().nonnegative() }).optional() }).strict().parse(value);
    return getSessionMessagePage(undefined, query);
  });
  ipcMain.handle(KAIRO_INVOKE.chatCreateReference, (_, value) => {
    const input = session.extend({ path: z.string().min(1).max(32768) }).parse(value);
    return createTaskReference(input.sessionId, input.path);
  });
  ipcMain.handle(KAIRO_INVOKE.chatGetDraft, (_, value) => getTaskDraft(id.parse(value)));
  ipcMain.handle(KAIRO_INVOKE.chatSaveDraft, (_, value) => {
    const input = draft.parse(value);
    return saveTaskDraft(input.sessionId, input.revision, input.data);
  });
  ipcMain.handle(KAIRO_INVOKE.chatArchiveTask, (_, value) => {
    const input = session.extend({ archived: z.boolean() }).parse(value);
    archiveTask(input.sessionId, input.archived);
  });
  ipcMain.handle(KAIRO_INVOKE.chatReadTask, (_, value) => {
    const input = session.extend({ version: z.number().int().nonnegative() }).parse(value);
    readTask(input.sessionId, input.version);
  });
}
