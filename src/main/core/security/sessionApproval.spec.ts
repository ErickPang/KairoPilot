import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { PermissionGuard } from './permissions';
import { checkPermission } from '../agent/toolPipeline';
import { approvalFingerprint, sessionApprovalOperation } from './sessionApproval';

vi.mock('../tools/web', () => ({ getConfiguredWebSearchProviders: () => [{ id: 'fixture', label: 'Fixture', permissionUrls: ['https://example.com/docs/search'] }] }));
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kairo-action-grants-'));
const otherRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'kairo-action-grants-other-'));
afterAll(() => { fs.rmSync(root, { recursive: true }); fs.rmSync(otherRoot, { recursive: true }); });
function guard(approvalMode: 'always' | 'on_write' = 'always') {
  const permissions = new PermissionGuard({ executionProfile: 'approved_execution', policy: { approvalMode }, fileSystem: { read: true, write: true, allowedPaths: [root, otherRoot] }, network: { enabled: true, allowedDomains: ['https://example.com/docs/'] }, shell: { enabled: true, allowedCommands: ['git', 'rm', 'node', 'python3'] } });
  const grants = new Set<string>();
  permissions.bindSessionApprovals({ allows: key => grants.has(key), remember: key => { grants.add(key); } });
  return permissions;
}
const file = (name: string) => path.join(root, name);

describe('conversation action approvals', () => {
  it('approves web search once across changing queries, result counts and internal provider arguments', () => {
    const permissions = guard();
    const first = checkPermission(permissions, 'web_search', { query: '保险政策', maxResults: 3 });
    expect(first.kind).toBe('approval');
    permissions.rememberSessionApproval('web_search', first.args, 'approval');
    for (const args of [{ query: '保险 新政策 2026', num: 10 }, { query: '金融监管总局', maxResults: 8, lr: 'lang_zh', __allowedSearchProviders: ['other'] }]) {
      expect(checkPermission(permissions, 'web_search', args).kind).toBe('allow');
    }
    expect(checkPermission(guard(), 'web_search', { query: '保险政策' }).kind).toBe('approval');
    expect(checkPermission(permissions, 'fetch_webpage', { url: 'https://example.com/docs/one' }).kind).toBe('approval');
    const offline = new PermissionGuard({ executionProfile: 'approved_execution', policy: { approvalMode: 'always' }, fileSystem: { read: true, write: true, allowedPaths: [root] }, network: { enabled: false }, shell: { enabled: false, allowedCommands: [] } });
    offline.bindSessionApprovals({ allows: () => true, remember: () => {} });
    expect(checkPermission(offline, 'web_search', { query: 'anything' }).kind).toBe('deny');
  });
  it('reuses directory reads across file tools, patterns and filenames, keeping writes and other roots separate', () => {
    const permissions = guard();
    permissions.rememberSessionApproval('read_file', { path: file('a.txt') }, 'approval');
    for (const [tool, args] of [['read_file', { path: file('sub/b.txt') }], ['list_directory', { path: root }], ['grep', { pattern: 'changed' }], ['glob', { pattern: '**/*.ts', path: root }]] as const) {
      expect(checkPermission(permissions, tool, args).kind).toBe('allow');
    }
    expect(checkPermission(permissions, 'write_file', { path: file('a.txt'), content: 'new' }).kind).toBe('approval');
    expect(checkPermission(permissions, 'read_file', { path: path.join(otherRoot, 'a.txt') }).kind).toBe('approval');
    expect(checkPermission(permissions, 'read_file', { path: '/outside/a.txt' }).kind).toBe('deny');
    expect(checkPermission(permissions, 'read_file', { path: file('AGENTS.md') }).kind).toBe('deny');
    fs.symlinkSync(otherRoot, file('linked'), 'dir');
    expect(checkPermission(permissions, 'read_file', { path: file('linked/a.txt') }).kind).toBe('approval');
  });
  it('reuses edits and writes within the authorized directory without granting deletion or sensitive writes', () => {
    const permissions = guard();
    permissions.rememberSessionApproval('write_file', { path: file('a.txt'), content: 'first' }, 'approval');
    expect(checkPermission(permissions, 'write_file', { path: file('sub/b.txt'), content: 'different' }).kind).toBe('allow');
    expect(checkPermission(permissions, 'edit_file', { file_path: file('a.txt'), old_string: 'first', new_string: 'second' }).kind).toBe('allow');
    expect(checkPermission(permissions, 'read_file', { path: file('a.txt') }).kind).toBe('approval');
    expect(checkPermission(permissions, 'write_file', { path: path.join(otherRoot, 'a.txt'), content: 'different' }).kind).toBe('approval');
    for (const tool of ['write_file', 'edit_file', 'delete_file']) {
      const args = { path: file('.env'), file_path: file('.env'), content: 'secret' };
      expect(permissions.getSessionApprovalScope(tool, args)).toBeUndefined();
      expect(checkPermission(permissions, tool, args).kind).toBe('approval');
    }
  });
  it('requires the first edit in on-write mode and reuses a granted directory modification action', () => {
    const permissions = guard('on_write');
    const edit = { file_path: file('edit.txt'), old_string: 'before', new_string: 'after' };
    expect(checkPermission(permissions, 'edit_file', edit).kind).toBe('approval');
    permissions.rememberSessionApproval('edit_file', edit, 'approval');
    expect(checkPermission(permissions, 'write_file', { path: file('another.txt'), content: 'new' }).kind).toBe('allow');
    expect(checkPermission(permissions, 'edit_file', { ...edit, file_path: file('.env') }).kind).toBe('approval');
  });
  it('reuses same-site reads across pages and GET/HEAD while preserving network and tool boundaries', () => {
    const permissions = guard();
    permissions.rememberSessionApproval('fetch_webpage', { url: 'https://example.com/docs/one' }, 'approval');
    expect(checkPermission(permissions, 'fetch_webpage', { url: 'https://example.com/docs/two?q=changed', maxLength: 500 }).kind).toBe('allow');
    for (const url of ['https://other.com/docs/one', 'https://example.com/private', 'http://example.com/docs/one']) expect(checkPermission(permissions, 'fetch_webpage', { url }).kind).toBe('deny');
    expect(checkPermission(permissions, 'http_request', { url: 'https://example.com/docs/one', method: 'GET' }).kind).toBe('approval');
    permissions.rememberSessionApproval('http_request', { url: 'https://example.com/docs/one', method: 'GET' }, 'approval');
    expect(checkPermission(permissions, 'http_request', { url: 'https://example.com/docs/two', method: 'HEAD' }).kind).toBe('allow');
    for (const args of [{ url: 'https://example.com/docs/', method: 'POST' }, { url: 'https://example.com/docs/', body: 'payload' }, { url: 'https://example.com/docs/', json: {} }, { url: 'https://example.com/docs/', headers: { Authorization: 'changed' } }, { url: 'https://user:password@example.com/docs/' }]) {
      expect(sessionApprovalOperation('http_request', args)).toBeUndefined();
      expect(permissions.shouldRequireApproval('http_request', args)).toBe(true);
    }
  });
  it('reuses recognized command actions across safe flags while requiring review of writes, code and boundary changes', () => {
    const permissions = guard();
    permissions.rememberSessionApproval('execute_command', { command: 'git status' }, 'approval');
    for (const args of [['status', '--short'], ['status', '--', 'sub/a.txt'], ['log', '--oneline', '--max-count=5'], ['ls-files', '--cached'], ['diff', '--no-ext-diff', '--no-textconv', '--stat']]) {
      expect(checkPermission(permissions, 'execute_command', { command: 'git', args }).kind).toBe('allow');
    }
    for (const args of [['reset', '--hard'], ['push'], ['-C', otherRoot, 'status'], ['status', '--', '../outside'], ['status', '--', path.join(otherRoot, 'a.txt')], ['log', '--output=out'], ['diff', '--ext-diff'], ['diff', '--no-ext-diff', '--no-textconv', '--output=out'], ['status', '--untracked-files=invalid']]) {
      expect(checkPermission(permissions, 'execute_command', { command: 'git', args }).kind).toBe('approval');
    }
    permissions.rememberSessionApproval('execute_command', { command: 'node', args: ['--version'] }, 'approval');
    expect(checkPermission(permissions, 'execute_command', { command: 'node', args: ['--help'] }).kind).toBe('allow');
    expect(checkPermission(permissions, 'execute_command', { command: 'node', args: ['-e', 'writeSomething()'] }).kind).toBe('approval');
    expect(permissions.getSessionApprovalScope('execute_command', { command: 'python3', args: ['-v'] })).toBeUndefined();
    expect(permissions.getSessionApprovalScope('execute_command', { command: 'rm', args: ['a'] })).toBeUndefined();
    expect(checkPermission(permissions, 'execute_command', { command: 'unlisted', args: [] }).kind).toBe('deny');
    expect(permissions.getSessionApprovalScope('execute_command', { command: 'git status && git reset --hard' })).toBeUndefined();
  });
  it('offers no reusable grant for unknown actions and never broadens an old argument-specific grant', () => {
    const permissions = guard();
    for (const tool of ['unknown_plugin', 'run_skill_script']) expect(permissions.getSessionApprovalScope(tool, {})).toBeUndefined();
    expect(() => permissions.rememberSessionApproval('unknown_plugin', {}, 'approval')).toThrow();
    const oldKey = approvalFingerprint(['web_search', { query: 'old' }]);
    permissions.bindSessionApprovals({ allows: key => key === oldKey, remember: () => {} });
    expect(permissions.shouldRequireApproval('web_search', { query: 'old' })).toBe(true);
    expect(approvalFingerprint({ a: 1, b: 2 })).toBe(approvalFingerprint({ b: 2, a: 1 }));
  });
});
