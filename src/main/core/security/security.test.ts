import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PermissionGuard } from './permissions';

describe('PermissionGuard', () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'kairopilot-security-'));
  const outsideRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'kairopilot-security-outside-'));
  const guard = new PermissionGuard({
    executionProfile: 'read_only_workspace',
    fileSystem: {
      read: true,
      write: true,
      allowedPaths: [workspaceRoot]
    },
    network: { enabled: false },
    shell: { enabled: false, allowedCommands: [] }
  });

  const safeFile = path.join(workspaceRoot, 'safe.txt');
  const sshDir = path.join(workspaceRoot, '.ssh');
  const sshKey = path.join(sshDir, 'id_rsa');
  const outsideFile = path.join(outsideRoot, 'outside.txt');
  const symlinkPath = path.join(workspaceRoot, 'outside-link.txt');

  beforeAll(() => {
    fs.writeFileSync(safeFile, 'safe content');
    fs.mkdirSync(sshDir, { recursive: true });
    fs.writeFileSync(sshKey, 'fake key');
    fs.writeFileSync(outsideFile, 'outside content');
  });

  afterAll(() => {
    if (fs.existsSync(symlinkPath)) {
      fs.unlinkSync(symlinkPath);
    }
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
    fs.rmSync(outsideRoot, { recursive: true, force: true });
  });

  it('允许访问工作区内的普通文件', () => {
    expect(guard.checkFileSystem(safeFile, 'read')).toBe(true);
  });

  it('阻止通过目录穿越访问工作区外文件', () => {
    expect(guard.checkFileSystem(path.join(workspaceRoot, '../package.json'), 'read')).toBe(false);
  });

  it('阻止访问敏感目录下的文件', () => {
    expect(guard.checkFileSystem(sshKey, 'read')).toBe(false);
  });

  it('阻止前缀伪造路径', () => {
    expect(guard.checkFileSystem(path.join(`${workspaceRoot}-evil`, 'file.txt'), 'read')).toBe(false);
  });

  it('阻止访问文件系统根目录', () => {
    expect(guard.checkFileSystem(path.parse(workspaceRoot).root, 'read')).toBe(false);
  });

  it('阻止通过符号链接逃逸工作区', () => {
    try {
      fs.symlinkSync(outsideFile, symlinkPath);
    } catch (error) {
      if (error instanceof Error && /exist/i.test(error.message)) {
        fs.unlinkSync(symlinkPath);
        fs.symlinkSync(outsideFile, symlinkPath);
      } else {
        throw error;
      }
    }

    expect(guard.checkFileSystem(symlinkPath, 'read')).toBe(false);
  });

  it('根据执行档位返回 shell 执行策略', () => {
    const approvedGuard = new PermissionGuard({
      executionProfile: 'approved_execution',
      fileSystem: { read: true, write: false, allowedPaths: [workspaceRoot] },
      network: { enabled: false },
      shell: { enabled: true, allowedCommands: ['npm'] }
    });
    const trustedGuard = new PermissionGuard({
      executionProfile: 'trusted_automation',
      fileSystem: { read: true, write: true, allowedPaths: [workspaceRoot] },
      network: { enabled: true },
      shell: { enabled: true, allowedCommands: ['npm'] }
    });

    expect(approvedGuard.getShellExecutionPolicy()).toEqual({
      enabled: true,
      requiresApproval: true,
      timeoutMs: 60000,
      maxBufferBytes: 262144,
      allowInteractive: false
    });
    expect(trustedGuard.getShellExecutionPolicy()).toEqual({
      enabled: true,
      requiresApproval: false,
      timeoutMs: 120000,
      maxBufferBytes: 1048576,
      allowInteractive: false
    });
  });
});
