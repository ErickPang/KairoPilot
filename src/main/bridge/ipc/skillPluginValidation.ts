import { z } from 'zod';

const NonEmptyStringSchema = z.string().trim().min(1);
const HttpsUrlSchema = z.string().trim().url().refine((value) => value.startsWith('https://'), {
  message: 'Only HTTPS URLs are allowed.'
});
const SkillScopeSchema = z.enum(['public', 'agent:workbench']);
const PluginInstallScopeSchema = z.enum(['public', 'workspace', 'agent:workbench']);
const ScopeSchema = z.string().trim().regex(/^(public|workspace|agent:[A-Za-z0-9_-]+)$/, 'Unsupported scope.');

export const SkillMarketplaceQueryInputSchema = z.union([
  z.object({
    kind: z.literal('curated')
  }),
  z.object({
    kind: z.literal('registry'),
    url: HttpsUrlSchema
  })
]);

export const SkillsRegistryEntryInputSchema = z.union([
  HttpsUrlSchema,
  z.object({
    type: z.enum(['manifest', 'claude_marketplace']),
    url: HttpsUrlSchema,
    name: z.string().trim().max(160).optional(),
    enabled: z.boolean().optional()
  })
]);

export const SkillsRegistryInputSchema = z.array(SkillsRegistryEntryInputSchema).max(50);

export const SkillPrepareInstallInputSchema = z.object({
  id: NonEmptyStringSchema.max(160),
  scope: SkillScopeSchema.default('public'),
  marketplaceQuery: SkillMarketplaceQueryInputSchema.optional()
});

export const SkillRequestInputSchema = z.object({
  requestId: NonEmptyStringSchema.max(200)
});

export const SkillImportInputSchema = z.object({
  sourceFile: NonEmptyStringSchema.max(2000),
  scope: SkillScopeSchema.default('public')
});

export const SkillUninstallInputSchema = z.object({
  id: NonEmptyStringSchema.max(160),
  scope: SkillScopeSchema.default('public')
});

export const SkillRollbackInputSchema = SkillUninstallInputSchema;

const PluginActionObjectInputSchema = z.object({
  id: NonEmptyStringSchema.max(160),
  scope: ScopeSchema.default('public')
});

export const PluginActionInputSchema = PluginActionObjectInputSchema;

export const PluginSetEnabledInputSchema = PluginActionObjectInputSchema.extend({
  enabled: z.boolean()
});

export const PluginRegistryUrlInputSchema = HttpsUrlSchema;

export const PluginPrepareInstallInputSchema = z.object({
  id: NonEmptyStringSchema.max(160),
  scope: PluginInstallScopeSchema.default('public'),
  registryUrl: HttpsUrlSchema.optional()
});

export const PluginPrepareImportInputSchema = z.object({
  sourceFile: NonEmptyStringSchema.max(2000),
  scope: PluginInstallScopeSchema.default('public')
});

export const PluginRequestInputSchema = z.object({
  requestId: NonEmptyStringSchema.max(200)
});

export const PluginRollbackInputSchema = PluginActionObjectInputSchema;
