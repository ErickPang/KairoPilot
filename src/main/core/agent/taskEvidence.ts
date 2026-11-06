import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { TextDecoder } from 'node:util';
import type { ToolDefinition } from '../llm/types';
import type { PermissionGuard } from '../security/permissions';
import { redactSensitiveText } from '../security/permissions';
import { getRunById } from '../../store/chat';
import { insertArtifact, insertVerification } from '../../store/workbench';
import { unwrapToolExecutionResult } from '../tools/result';

const SNAPSHOT_LIMIT_BYTES = 128 * 1024;
interface FileSnapshot { exists?: boolean; text?: string; hash?: string }

export async function captureFileSnapshot(target: string, guard: PermissionGuard): Promise<FileSnapshot> {
  if (!guard.checkFileSystem(target, 'read')) return {};
  try {
    const stat = await fs.stat(target);
    if (!stat.isFile() || stat.size > SNAPSHOT_LIMIT_BYTES) return { exists: true };
    const buffer = await fs.readFile(target);
    if (buffer.length > SNAPSHOT_LIMIT_BYTES) return { exists: true };
    const hash = createHash('sha256').update(buffer).digest('hex');
    if (buffer.includes(0) || /(^\.env($|\.)|\.(pem|key|p12)$)/i.test(path.basename(target))) return { exists: true, hash };
    try {
      const text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
      return { exists: true, hash, text: redactSensitiveText(text) };
    } catch { return { exists: true, hash }; }
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ENOENT' ? { exists: false, text: '' } : {};
  }
}

export async function prepareTaskEvidence(tool: ToolDefinition, args: Record<string, unknown>, guard: PermissionGuard) {
  if (tool.metadata?.source !== 'builtin') return undefined;
  if (tool.name !== 'write_file' && tool.name !== 'delete_file' && tool.name !== 'edit_file') return undefined;
  const target = typeof args.path === 'string' ? args.path : typeof args.file_path === 'string' ? args.file_path : '';
  if (!path.isAbsolute(target) || !guard.checkFileSystem(target, 'write')) return undefined;
  // Capture only after the runtime has approved this exact operation.
  return { target, before: await captureFileSnapshot(target, guard) };
}

export async function recordTaskEvidence(params: {
  runId: string; toolCallId?: string; tool: ToolDefinition; args: Record<string, unknown>;
  output: unknown; guard: PermissionGuard; file?: Awaited<ReturnType<typeof prepareTaskEvidence>>; interrupted: boolean;
}) {
  if (params.tool.metadata?.source !== 'builtin') return;
  const result = unwrapToolExecutionResult(params.output);
  const isVerification = params.tool.name === 'execute_command' && params.args.verification === true;
  if (!params.file && !isVerification) return;
  const run = getRunById(params.runId);
  if (!run?.executionContext || !params.toolCallId) return;
  if (params.file && result.ok && !params.interrupted) {
    const after = await captureFileSnapshot(params.file.target, params.guard);
    const before = params.file.before;
    const diffAvailable = typeof before.text === 'string' && typeof after.text === 'string';
    insertArtifact({
      runId: run.id, sessionId: run.sessionId, toolCallId: params.toolCallId, path: params.file.target,
      operation: params.tool.name === 'delete_file' ? 'deleted' : before.exists === false ? 'created' : before.exists ? 'modified' : 'written',
      beforeHash: before.hash, afterHash: after.hash, diffAvailable
    }, diffAvailable ? before.text : undefined, diffAvailable ? after.text : undefined);
  }
  if (isVerification) {
    const details = (result.ok ? result.data : result.details) as { stdout?: unknown; stderr?: unknown; exitCode?: unknown } | undefined;
    const exitCode = typeof details?.exitCode === 'number' ? details.exitCode : undefined;
    insertVerification({
      runId: run.id, sessionId: run.sessionId, toolCallId: params.toolCallId,
      command: redactSensitiveText(JSON.stringify({ command: params.args.command, args: params.args.args || [] })),
      cwd: run.executionContext.executionRoot,
      status: params.interrupted || exitCode === undefined ? 'interrupted' : result.ok && exitCode === 0 ? 'passed' : 'failed',
      exitCode, stdout: redactSensitiveText(String(details?.stdout || '').slice(0, 8000)),
      stderr: redactSensitiveText(String(details?.stderr || (!result.ok ? result.error : '')).slice(0, 8000))
    });
  }
}
