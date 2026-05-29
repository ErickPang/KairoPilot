import { z } from 'zod';

const ProviderTypeSchema = z.enum([
  'openai',
  'openrouter',
  'ollama',
  'anthropic',
  'deepseek',
  'zhipu',
  'kimi',
  'qianwen',
  'custom'
]);

const NonEmptyStringSchema = z.string().trim().min(1);
const StringListSchema = z.array(z.string().trim().min(1)).max(200).default([]);

const ModelOptionSchema = z.object({
  id: NonEmptyStringSchema,
  name: NonEmptyStringSchema
});

export const ModelConfigInputSchema = z.object({
  id: NonEmptyStringSchema.regex(/^[a-zA-Z0-9_-]+$/, 'Invalid provider key.'),
  name: NonEmptyStringSchema,
  provider: ProviderTypeSchema,
  baseUrl: z.string().trim(),
  apiKey: z.string(),
  apiKeyStored: z.boolean().optional(),
  model: NonEmptyStringSchema,
  availableModels: z.array(ModelOptionSchema).max(500).optional()
});

export const LlmProviderInputSchema = ModelConfigInputSchema.pick({
  provider: true,
  apiKey: true,
  baseUrl: true,
  model: true
}).partial({
  apiKey: true,
  baseUrl: true,
  model: true
}).extend({
  id: z.preprocess(
    (value) => typeof value === 'string' && value.trim() === '' ? undefined : value,
    NonEmptyStringSchema.regex(/^[a-zA-Z0-9_-]+$/, 'Invalid provider key.').optional()
  ),
  model: z.preprocess(
    (value) => typeof value === 'string' && value.trim() === '' ? undefined : value,
    NonEmptyStringSchema.optional()
  ),
  provider: ProviderTypeSchema.default('openai')
});

const PolicySchema = z.object({
  approvalMode: z.enum(['never', 'on_write', 'on_external', 'always']),
  environmentScope: z.enum(['workspace', 'allowed_paths', 'isolated_env']),
  dataClass: z.enum(['public', 'project', 'sensitive']),
  redactSensitiveOutput: z.boolean()
});

const AgentPermissionSchema = z.object({
  executionProfile: z.enum(['chat_only', 'read_only_workspace', 'approved_execution', 'trusted_automation']),
  policy: PolicySchema,
  fileSystem: z.object({
    read: z.boolean(),
    write: z.boolean(),
    allowedPaths: StringListSchema
  }),
  network: z.object({
    enabled: z.boolean(),
    allowedDomains: StringListSchema
  }),
  shell: z.object({
    enabled: z.boolean(),
    allowedCommands: StringListSchema
  })
});

export const AgentConfigInputSchema = z.object({
  id: NonEmptyStringSchema.max(120),
  name: NonEmptyStringSchema.max(120),
  workspace: z.string().trim(),
  workspaceName: z.string().trim().max(120).optional(),
  systemPrompt: z.string().max(100_000),
  identityPrompt: z.string().max(100_000),
  userPrompt: z.string().max(100_000),
  soulPrompt: z.string().max(100_000),
  model: z.string().trim(),
  permissions: AgentPermissionSchema
});

export const IdInputSchema = NonEmptyStringSchema.max(160);

export const DeleteAgentInputSchema = z.object({
  id: IdInputSchema,
  deleteWorkspace: z.boolean(),
  confirmation: z.string().trim().max(260).optional()
}).strict().refine((value) => (
  !value.deleteWorkspace || value.confirmation === `delete-agent:${value.id}:workspace`
), {
  message: 'Workspace deletion requires explicit confirmation.',
  path: ['confirmation']
});

export const AgentDraftSeedSchema = AgentConfigInputSchema.partial();

export const AgentInitInputSchema = z.union([
  IdInputSchema,
  AgentConfigInputSchema,
  z.object({
    agent: AgentConfigInputSchema,
    model: ModelConfigInputSchema
  }).strict()
]);

export const LegacyAgentConfigInputSchema = z.object({
  provider: ProviderTypeSchema.default('openai'),
  apiKey: z.string().default(''),
  apiKeyStored: z.boolean().optional(),
  baseUrl: z.string().trim().default(''),
  model: z.string().trim().default(''),
  workspace: z.string().trim().default(''),
  systemPrompt: z.string().default(''),
  enableShell: z.boolean().default(false),
  enableNetwork: z.boolean().default(false),
  enableFileSystemRead: z.boolean().default(false),
  enableFileSystemWrite: z.boolean().default(false),
  allowedPaths: StringListSchema,
  allowedDomains: StringListSchema,
  allowedCommands: StringListSchema,
  permissions: AgentPermissionSchema.optional()
});

export const AppearanceConfigInputSchema = z.object({
  theme: z.enum(['system', 'light', 'dark', 'slate', 'warm'])
});

const WebSearchToggleSchema = z.object({
  enabled: z.boolean()
});

export const WebSearchConfigInputSchema = z.object({
  timeoutMs: z.number().finite(),
  preferredProviders: z.array(z.enum(['searxng', 'tavily', 'bing', 'duckduckgo', 'baidu'])).max(20),
  providers: z.object({
    searxng: WebSearchToggleSchema.extend({
      baseUrl: z.string().trim()
    }),
    tavily: WebSearchToggleSchema.extend({
      baseUrl: z.string().trim(),
      apiKey: z.string(),
      apiKeyStored: z.boolean().optional()
    }),
    bing: WebSearchToggleSchema,
    duckduckgo: WebSearchToggleSchema,
    baidu: WebSearchToggleSchema
  })
});

export function parseIpcInput<T>(schema: z.ZodType<T>, value: unknown, label: string): T {
  const parsed = schema.safeParse(value);
  if (parsed.success) {
    return parsed.data;
  }

  const issue = parsed.error.issues[0];
  const path = issue?.path.length ? issue.path.join('.') : 'payload';
  throw new Error(`Invalid ${label}: ${path} ${issue?.message || 'is invalid'}`);
}
