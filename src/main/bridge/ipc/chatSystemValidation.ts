import { z } from 'zod';

const NonEmptyStringSchema = z.string().trim().min(1);
const OptionalStringSchema = z.string().trim().optional();
const SearchTextSchema = z.string().trim().max(500).optional();
const LocalOrHttpUrlSchema = z.string().trim().refine((value) => {
  if (!value) {
    return true;
  }
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}, 'Must be an HTTP or HTTPS URL.');

function createPositiveIntegerInputSchema(max: number) {
  return z.preprocess((value) => {
    if (value === undefined || value === null || value === '') {
      return undefined;
    }
    const numberValue = typeof value === 'number' || typeof value === 'string'
      ? Number(value)
      : NaN;
    if (!Number.isFinite(numberValue) || numberValue < 1) {
      return undefined;
    }
    return Math.min(Math.floor(numberValue), max);
  }, z.number().int().min(1).max(max).optional());
}

const PageNumberSchema = createPositiveIntegerInputSchema(100000);
const RunQueryPageSizeSchema = createPositiveIntegerInputSchema(100);
const AuditLogPageSizeSchema = createPositiveIntegerInputSchema(1000);
export const SessionIdInputSchema = NonEmptyStringSchema.max(200);

export const CreateSessionTitleInputSchema = z.string().trim().max(300).optional();
export const CreateSessionInputSchema = z.union([CreateSessionTitleInputSchema, z.object({ title: CreateSessionTitleInputSchema, projectId: NonEmptyStringSchema.max(200).optional() }).strict()]);

export const UpdateSessionTitleInputSchema = z.object({
  sessionId: SessionIdInputSchema,
  title: z.string().trim().min(1).max(300)
});

export const RunIdInputSchema = z.object({
  runId: NonEmptyStringSchema.max(200)
});

export const RetryStepInputSchema = RunIdInputSchema.extend({
  stepId: NonEmptyStringSchema.max(200)
});

export const MonitoringTokenQueryInputSchema = z.object({
  projectId: NonEmptyStringSchema.max(200).optional(),
  agentId: NonEmptyStringSchema.max(200).optional(),
  page: PageNumberSchema,
  pageSize: RunQueryPageSizeSchema,
  search: SearchTextSchema,
  model: z.string().trim().min(1).max(300).optional(),
  role: z.enum(['all', 'system', 'user', 'assistant', 'tool']).optional(),
  sessionId: SessionIdInputSchema.optional(),
  startTime: z.number().finite().nonnegative().optional(),
  endTime: z.number().finite().nonnegative().optional()
}).strict().optional().default({});

export const AuditLogQueryInputSchema = z.object({
    page: PageNumberSchema,
    pageSize: AuditLogPageSizeSchema,
    search: SearchTextSchema,
    status: z.enum(['all', 'success', 'error']).optional(),
    tool: NonEmptyStringSchema.max(200).optional(),
    tag: NonEmptyStringSchema.max(200).optional(),
    sessionId: SessionIdInputSchema.optional(),
    runId: NonEmptyStringSchema.max(200).optional(),
    stepId: NonEmptyStringSchema.max(200).optional(),
    startTime: z.number().finite().nonnegative().optional(),
    endTime: z.number().finite().nonnegative().optional()
  }).strict().optional().default({});

export const ApprovalResponseInputSchema = z.object({
  id: NonEmptyStringSchema.max(200),
  approved: z.boolean(),
  scope: z.enum(['once', 'session']).default('once')
}).strict().refine(value => value.approved || value.scope === 'once', 'Denied operations cannot grant conversation permission');

export const PrepareAttachmentInputSchema = z.object({
  path: NonEmptyStringSchema.max(3000),
  name: OptionalStringSchema,
  mimeType: OptionalStringSchema
});

export const PrepareAttachmentsInputSchema = z.object({
  sessionId: SessionIdInputSchema,
  files: z.array(PrepareAttachmentInputSchema).min(1).max(20)
});

export const ChatAttachmentInputSchema = z.object({
  id: NonEmptyStringSchema.max(200),
  sessionId: SessionIdInputSchema,
  name: NonEmptyStringSchema.max(500),
  mimeType: NonEmptyStringSchema.max(300),
  size: z.number().finite().nonnegative(),
  kind: z.enum(['image', 'text', 'file']),
  originalPath: z.string().optional(),
  storedPath: NonEmptyStringSchema.max(3000),
  contentHash: z.string().max(256),
  previewUri: z.string().optional(),
  extractedText: z.string().optional(),
  createdAt: z.number().finite().nonnegative()
});

export const DeleteAttachmentInputSchema = z.object({
  sessionId: SessionIdInputSchema,
  attachment: ChatAttachmentInputSchema
});

const DialogFilterSchema = z.object({
  name: NonEmptyStringSchema.max(100),
  extensions: z.array(NonEmptyStringSchema.max(30)).min(1).max(50)
});

export const SelectFileInputSchema = z.object({
  filters: z.array(DialogFilterSchema).max(20).optional()
}).optional();

export const OllamaBaseUrlInputSchema = LocalOrHttpUrlSchema.optional();

export const OllamaPullInputSchema = z.object({
  baseUrl: LocalOrHttpUrlSchema.optional(),
  modelName: NonEmptyStringSchema.max(200).regex(/^[A-Za-z0-9._:/-]+$/, 'Invalid model name.')
});

export const OllamaDeleteModelSchema = z.object({
  baseUrl: LocalOrHttpUrlSchema.optional(),
  modelName: NonEmptyStringSchema.max(200)
});

export const OllamaListModelsSchema = LocalOrHttpUrlSchema.optional();
