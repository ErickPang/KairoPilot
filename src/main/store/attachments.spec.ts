import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { prepareChatAttachments } from './attachments';

const tempRoots: string[] = [];

async function createTempRoot() {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'kairopilot-attachments-'));
  tempRoots.push(tempRoot);
  return tempRoot;
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((tempRoot) => fs.rm(tempRoot, { recursive: true, force: true })));
});

describe('prepareChatAttachments', () => {
  it('preserves the original display name while bounding the stored file name', async () => {
    const tempRoot = await createTempRoot();
    const workspace = path.join(tempRoot, 'workspace');
    const sourcePath = path.join(tempRoot, 'source.txt');
    await fs.mkdir(workspace, { recursive: true });
    await fs.writeFile(sourcePath, 'uploaded content', 'utf-8');

    const originalName = `示例文件 (最终版) ${'very-long-name-'.repeat(28)}.txt`;
    const [attachment] = await prepareChatAttachments({
      sessionId: 'session-1',
      workspace,
      files: [{ path: sourcePath, name: originalName, mimeType: 'text/plain' }]
    });

    expect(attachment.name).toBe(originalName);
    expect(attachment.extractedText).toBe('uploaded content');
    expect(Buffer.byteLength(path.basename(attachment.storedPath))).toBeLessThanOrEqual(240);
    await expect(fs.access(attachment.storedPath)).resolves.toBeUndefined();
  });
});
