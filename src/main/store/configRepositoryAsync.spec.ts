import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ available: true }));
vi.mock('electron', () => ({ app: { isPackaged: true }, safeStorage: {
  isAsyncEncryptionAvailable: async () => state.available,
  decryptStringAsync: async (value: Buffer) => ({ result: value.toString('utf8').slice('sealed:'.length), shouldReEncrypt: false })
} }));
import { DEFAULT_CONFIG } from './configDefaults';
import { loadKairoPilotConfigFromDiskAsync } from './configRepository';
const roots: string[] = [];
const encrypted = (value: string) => 'safe-storage:v1:' + Buffer.from('sealed:' + value).toString('base64');
function fixture(key: string) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kairo-async-config-')); roots.push(root);
  const config = structuredClone(DEFAULT_CONFIG);
  config.models.providers.fixture = { provider: 'custom', baseUrl: 'https://example.invalid', apiKey: '', apiKeyEncrypted: encrypted(key), model: [{ id: 'fixture', name: 'Fixture' }] };
  config.webSearch.providers.tavily.apiKeyEncrypted = encrypted(key + '-search');
  const file = path.join(root, 'config.json'), content = JSON.stringify(config); fs.writeFileSync(file, content);
  return { root, file, content };
}
afterEach(() => { state.available = true; for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
describe('asynchronous configuration hydration', () => {
  it('hydrates provider and search credentials without writing files or backups', async () => {
    const item = fixture('repository-fixture');
    const loaded = await loadKairoPilotConfigFromDiskAsync(item.file);
    expect(loaded.config.models.providers.fixture.apiKey).toBe('repository-fixture');
    expect(loaded.config.webSearch.providers.tavily.apiKey).toBe('repository-fixture-search');
    expect(fs.readFileSync(item.file, 'utf8')).toBe(item.content); expect(fs.readdirSync(item.root)).toEqual(['config.json']);
  });
  it('preserves the original file when secure storage cannot decrypt a saved key', async () => {
    const item = fixture('unavailable-repository-fixture'); state.available = false;
    await expect(loadKairoPilotConfigFromDiskAsync(item.file)).rejects.toThrow('Unable to decrypt');
    expect(fs.readFileSync(item.file, 'utf8')).toBe(item.content); expect(fs.readdirSync(item.root)).toEqual(['config.json']);
  });
});
