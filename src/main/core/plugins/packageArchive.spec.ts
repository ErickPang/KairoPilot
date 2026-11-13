import { crc32 } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { readPluginArchive } from './packageArchive';

function zip(entries: Array<{ name: string; text: string; symlink?: boolean }>) {
  const local: Buffer[] = [], central: Buffer[] = []; let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name), data = Buffer.from(entry.text), checksum = crc32(data);
    const head = Buffer.alloc(30); head.writeUInt32LE(0x04034b50); head.writeUInt32LE(checksum, 14); head.writeUInt32LE(data.length, 18); head.writeUInt32LE(data.length, 22); head.writeUInt16LE(name.length, 26);
    local.push(head, name, data);
    const row = Buffer.alloc(46); row.writeUInt32LE(0x02014b50); row.writeUInt32LE(checksum, 16); row.writeUInt32LE(data.length, 20); row.writeUInt32LE(data.length, 24); row.writeUInt16LE(name.length, 28); row.writeUInt32LE(entry.symlink ? (0xa000 << 16) >>> 0 : 0, 38); row.writeUInt32LE(offset, 42); central.push(row, name); offset += head.length + name.length + data.length;
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}
const manifest = JSON.stringify({ packageVersion: 1, id: 'fixture', name: 'Fixture', description: '', author: 'Fixture', version: '1', skills: ['skills/test'] });
describe('bounded plugin archive reader', () => {
  it('reads package metadata and resources without extracting or executing scripts', () => {
    const result = readPluginArchive(zip([{ name: 'package/plugin.json', text: manifest }, { name: 'package/skills/test/SKILL.md', text: '# Instructions' }, { name: 'package/payload.js', text: 'throw new Error("never execute")' }]));
    expect(result.manifest.id).toBe('fixture'); expect(result.files['skills/test/SKILL.md']).toBe('# Instructions');
  });
  it.each(['../outside', '/outside', 'a/../../outside', 'C:/outside', 'a\\outside'])('rejects an unsafe entry before extraction: %s', name => { expect(() => readPluginArchive(zip([{ name, text: 'payload' }]))).toThrow('Unsafe ZIP'); });
  it('rejects symlinks, case-colliding files and corrupt content', () => {
    expect(() => readPluginArchive(zip([{ name: 'link', text: '/outside', symlink: true }]))).toThrow('symlinks');
    expect(() => readPluginArchive(zip([{ name: 'A', text: '' }, { name: 'a', text: '' }]))).toThrow('Duplicate');
    const bytes = zip([{ name: 'data', text: 'content' }]); bytes[34] ^= 1; expect(() => readPluginArchive(bytes)).toThrow('Corrupt');
  });
  it('rejects malformed and oversized archives', () => {
    expect(() => readPluginArchive(Buffer.from('bad'))).toThrow('Invalid ZIP');
    expect(() => readPluginArchive(Buffer.alloc(8 * 1024 * 1024 + 1))).toThrow('8 MiB');
  });
});
