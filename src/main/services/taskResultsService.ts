import { summarizeTaskChanges } from './taskChangeSummary';
import fs from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { getRunById } from '../store/chat';
import * as store from '../store/workbench';
import { redactSensitiveText } from '../core/security/permissions';
import { requireOwnedSession, permissionGuardForSession } from './projectService';
import type { TaskArtifact, TaskResults } from '../../shared/contracts';

function artifactGuard(artifact: TaskArtifact) {
  const session = requireOwnedSession(artifact.sessionId);
  const run = getRunById(artifact.runId);
  if (!run?.executionContext || run.sessionId !== session.id || run.executionContext.executionRoot !== session.executionRoot) throw new Error('Artifact execution context is unavailable.');
  return permissionGuardForSession(session);
}

export async function getTaskResults(sessionId: string): Promise<TaskResults> {
  const session = requireOwnedSession(sessionId);
  const files = new Map<string, Promise<{ size: number; isFile: boolean; hash?: string }>>();
  const currentFile = (filePath: string) => {
    if (!files.has(filePath)) files.set(filePath, (async () => {
      const stat = await fs.stat(filePath);
      return { size: stat.size, isFile: stat.isFile(), ...(stat.isFile() && stat.size <= 128 * 1024 ? { hash: createHash('sha256').update(await fs.readFile(filePath)).digest('hex') } : {}) };
    })());
    return files.get(filePath)!;
  };
  const resolveArtifact = async (artifact: TaskArtifact): Promise<TaskArtifact> => {
    try {
      if (!artifactGuard(artifact).checkFileSystem(artifact.path, 'read')) return { ...artifact, availability: 'denied' };
      const stat = await currentFile(artifact.path);
      if (!artifact.afterHash) return { ...artifact, availability: artifact.operation === 'deleted' ? 'changed' : 'available' };
      if (!stat.isFile || stat.size > 128 * 1024) return { ...artifact, availability: 'changed' };
      return { ...artifact, availability: stat.hash === artifact.afterHash ? 'available' : 'changed' };
    } catch (error) {
      return { ...artifact, availability: (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'missing' : 'denied' };
    }
  };
  const records = store.listArtifacts(sessionId);
  const artifacts: TaskArtifact[] = [];
  for (let index = 0; index < records.length; index += 8) artifacts.push(...await Promise.all(records.slice(index, index + 8).map(resolveArtifact)));
  const verifications = store.listVerifications(sessionId).map((record) => {
    try {
      const run = getRunById(record.runId);
      if (!run || run.sessionId !== session.id) throw new Error('Verification belongs to another task.');
      if (!run.executionContext || !permissionGuardForSession(session).checkFileSystem(record.cwd, 'read')) throw new Error('Read permission unavailable.');
      return { ...record, outputAvailable: true };
    } catch {
      return { ...record, command: '', stdout: '', stderr: '', outputAvailable: false };
    }
  });
  return { artifacts, verifications, changes: summarizeTaskChanges(artifacts) };
}

export function getOwnedArtifactDiff(id: string) {
  const artifact = store.getArtifact(id);
  if (!artifact || !artifactGuard(artifact).checkFileSystem(artifact.path, 'read')) throw new Error('Artifact is unavailable under current read permissions.');
  const diff = store.getArtifactDiff(id);
  if (!diff) throw new Error('No readable text snapshots are available for this operation.');
  return diff;
}

export async function getWorkingDirectoryDiff(sessionId: string): Promise<{ available: boolean; diff: string; omittedFiles?: number }> {
  const session = requireOwnedSession(sessionId);
  if (!session.executionRoot) return { available: false, diff: 'Historical execution directory was not recorded.' };
  // This endpoint reads only the selected task's root and has no write/revert path.
  const guard = permissionGuardForSession(session);
  if (!guard.checkFileSystem(session.executionRoot, 'read')) throw new Error('Project read permission is required.');
  try {
    const options = {
      timeout: 5000, maxBuffer: 512 * 1024,
      env: { ...process.env, GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' }
    };
    const prefix = ['--no-optional-locks', '-C', session.executionRoot, '-c', 'core.fsmonitor=false', 'diff', '--relative', '--no-ext-diff', '--no-textconv', '--no-color'];
    const names = await promisify(execFile)('git', [...prefix, '--name-only', '-z', 'HEAD', '--', '.'], options);
    const paths = names.stdout.split('\0').filter(Boolean);
    if (paths.length > 200) return { available: false, diff: 'Too many changed files for a bounded preview.' };
    const readable = paths.filter((name) => guard.checkFileSystem(path.resolve(session.executionRoot!, name), 'read') && !/(^\.env($|\.)|\.(pem|key|p12)$)/i.test(path.basename(name)));
    if (!readable.length) return { available: true, diff: '', omittedFiles: paths.length };
    const { stdout } = await promisify(execFile)('git', [...prefix, 'HEAD', '--', ...readable], options);
    return { available: true, diff: redactSensitiveText(stdout), omittedFiles: paths.length - readable.length };
  } catch {
    return { available: false, diff: 'Git HEAD is unavailable, the directory is not a Git repository, or the diff exceeds the preview limit.' };
  }
}

export async function getTaskChanges(sessionId: string) {
  return (await getTaskResults(sessionId)).changes || [];
}

export function getTaskChangeDiff(sessionId: string, filePath: string,runId?:string) {
  requireOwnedSession(sessionId);
  if(runId&&getRunById(runId)?.sessionId!==sessionId)throw new Error('Run does not belong to this task.');
  const entries = store.listArtifacts(sessionId).filter((entry) => entry.path === filePath&&(!runId||entry.runId===runId)).reverse();
  if (!entries.length || entries.some((entry) => !artifactGuard(entry).checkFileSystem(entry.path, 'read'))) throw new Error('Change snapshots are unavailable under current read permissions.');
  const first = store.getArtifactDiff(entries[0].id);
  const last = store.getArtifactDiff(entries[entries.length - 1].id);
  if (!first || !last) throw new Error('Complete text boundaries are unavailable for this change summary.');
  return { path: filePath, oldText: first.oldText, newText: last.newText };
}
