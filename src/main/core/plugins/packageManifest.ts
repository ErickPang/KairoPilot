import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { PluginPackage } from '../../../shared/contracts';

export const PluginIdSchema = z.string().max(160).regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/).refine(value => value !== '.' && value !== '..');
const relativePath = z.string().max(500).refine(value => !/[\\:]/.test(value) && !Array.from(value).some(char => char.charCodeAt(0) < 32) && !value.startsWith('/') && value.split('/').every(part => part !== '' && part !== '.' && part !== '..' && !/[. ]$/.test(part)));
const permission = z.object({
  fileSystem: z.object({ read: z.boolean().optional(), write: z.boolean().optional(), paths: z.array(z.string()).optional() }).optional(),
  network: z.object({ enabled: z.boolean().optional(), domains: z.array(z.string()).optional() }).optional(),
  shell: z.object({ enabled: z.boolean().optional(), commands: z.array(z.string()).optional() }).optional()
});
const connection = z.discriminatedUnion('transport', [
  z.object({ id: PluginIdSchema, name: z.string().min(1).max(160), transport: z.literal('http'), url: z.url().refine(value => { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password && !url.hash && !url.search; }) }).strict(),
  z.object({ id: PluginIdSchema, name: z.string().min(1).max(160), transport: z.literal('stdio'), command: z.string().min(1).max(2000), args: z.array(z.string().max(4000)).max(50).default([]), executionMode: z.enum(['restricted-local', 'trusted-local']).default('restricted-local') }).strict()
]);
export const PluginManifestSchema = z.object({
  packageVersion: z.literal(1), id: PluginIdSchema, name: z.string().min(1).max(160), description: z.string().max(4000),
  version: z.string().min(1).max(100), author: z.string().min(1).max(160), icon: z.string().optional(),
  homepage: z.string().optional(), license: z.string().optional(),
  connections: z.array(connection).max(20).default([]), skills: z.array(relativePath).max(30).default([]),
  tools: z.array(z.object({ name: z.string().min(1).max(128), description: z.string().max(4000), connectionId: PluginIdSchema, inputSchema: z.record(z.string(), z.unknown()).optional(), requiredPermissions: permission.optional() })).max(500).default([]),
  capabilities: z.array(z.object({ id: PluginIdSchema, label: z.string(), description: z.string().optional(), riskLevel: z.enum(['low', 'medium', 'high', 'critical']), requiredPermissions: permission.optional() })).max(50).default([]),
  riskLevel: z.enum(['low', 'medium', 'high', 'critical']).default('medium')
}).strict().superRefine((value, context) => {
  if (new Set(value.connections.map(item => item.id)).size !== value.connections.length) context.addIssue({ code: 'custom', message: 'Duplicate connection IDs.' });
  if (new Set(value.tools.map(item => `${item.connectionId}:${item.name}`)).size !== value.tools.length) context.addIssue({ code: 'custom', message: 'Duplicate tool names.' });
  if (new Set(value.skills.map(item => item.toLowerCase())).size !== value.skills.length) context.addIssue({ code: 'custom', message: 'Duplicate skill roots.' });
  for (const tool of value.tools) if (!value.connections.some(item => item.id === tool.connectionId)) context.addIssue({ code: 'custom', message: 'Tool refers to an unknown connection.' });
});

export function parsePluginPackage(value: unknown): PluginPackage {
  const parsed = z.object({ manifest: PluginManifestSchema, files: z.record(relativePath, z.string()).default({}) }).strict().parse(value);
  if (Object.keys(parsed.files).length > 128 || Buffer.byteLength(JSON.stringify(parsed)) > 2 * 1024 * 1024) throw new Error('Plugin package exceeds the resource limit.');
  const names = Object.keys(parsed.files).map(name => name.toLowerCase());
  if (new Set(names).size !== names.length || names.some(name => names.some(other => other.startsWith(name + '/')))) throw new Error('Plugin resource paths collide.');
  for (const skill of parsed.manifest.skills) if (!Object.prototype.hasOwnProperty.call(parsed.files, `${skill}/SKILL.md`)) throw new Error(`Missing skill resource: ${skill}/SKILL.md`);
  return parsed;
}
export function packageContent(value: PluginPackage) {
  return JSON.stringify({ manifest: value.manifest, files: Object.fromEntries(Object.entries(value.files).sort(([a], [b]) => a.localeCompare(b))) });
}
export function packageHash(content: string) { return createHash('sha256').update(content).digest('hex'); }
