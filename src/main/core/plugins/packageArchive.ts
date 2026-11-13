import { inflateRawSync, crc32 } from 'node:zlib';
import { PluginManifestSchema, parsePluginPackage } from './packageManifest';

/** Read bounded ZIP resources in memory. No archive path is ever extracted to disk. */
export function readPluginArchive(bytes: Buffer) {
  if (bytes.length > 8 * 1024 * 1024) throw new Error('Plugin archive exceeds 8 MiB.');
  let end = bytes.length - 22;
  while (end >= Math.max(0, bytes.length - 65557) && bytes.readUInt32LE(end) !== 0x06054b50) end--;
  if (end < 0 || bytes.readUInt32LE(end) !== 0x06054b50) throw new Error('Invalid ZIP directory.');
  if (bytes.readUInt16LE(end + 4) || bytes.readUInt16LE(end + 6)) throw new Error('Multi-disk ZIP is unsupported.');
  const count = bytes.readUInt16LE(end + 10);
  if (count > 160) throw new Error('Too many plugin resources.');
  let cursor = bytes.readUInt32LE(end + 16);
  const files: Record<string, string> = Object.create(null);
  const names = new Set<string>();
  let total = 0;
  for (let index = 0; index < count; index++) {
    if (cursor + 46 > end || bytes.readUInt32LE(cursor) !== 0x02014b50) throw new Error('Invalid ZIP entry.');
    const flags = bytes.readUInt16LE(cursor + 8), method = bytes.readUInt16LE(cursor + 10);
    const compressed = bytes.readUInt32LE(cursor + 20), size = bytes.readUInt32LE(cursor + 24);
    const nameLength = bytes.readUInt16LE(cursor + 28), extra = bytes.readUInt16LE(cursor + 30), comment = bytes.readUInt16LE(cursor + 32);
    const offset = bytes.readUInt32LE(cursor + 42);
    const name = bytes.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8');
    if (!name || name.includes('\0') || name.includes('\\') || name.includes(':') || name.startsWith('/') || name.replace(/\/$/, '').split('/').some(part => !part || part === '.' || part === '..')) throw new Error('Unsafe ZIP path.');
    if (names.has(name.toLowerCase())) throw new Error('Duplicate ZIP path.');
    names.add(name.toLowerCase());
    if (((bytes.readUInt32LE(cursor + 38) >>> 16) & 0xf000) === 0xa000) throw new Error('Plugin symlinks are unsupported.');
    if (flags & 1 || ![0, 8].includes(method)) throw new Error('Unsupported ZIP encoding.');
    total += size;
    if (size > 2 * 1024 * 1024 || total > 2 * 1024 * 1024) throw new Error('Plugin resources exceed 2 MiB.');
    if (offset + 30 > cursor || bytes.readUInt32LE(offset) !== 0x04034b50) throw new Error('Invalid ZIP local entry.');
    const start = offset + 30 + bytes.readUInt16LE(offset + 26) + bytes.readUInt16LE(offset + 28);
    if (start + compressed > cursor) throw new Error('Invalid ZIP resource size.');
    const content = method === 8 ? inflateRawSync(bytes.subarray(start, start + compressed), { maxOutputLength: 2 * 1024 * 1024 }) : bytes.subarray(start, start + compressed);
    if (content.length !== size || crc32(content) !== bytes.readUInt32LE(cursor + 16)) throw new Error('Corrupt ZIP resource.');
    if (!name.endsWith('/')) files[name] = new TextDecoder('utf-8', { fatal: true }).decode(content);
    cursor += 46 + nameLength + extra + comment;
  }
  const manifests = Object.keys(files).filter(name => name === 'plugin.json' || name.endsWith('/plugin.json'));
  if (manifests.length !== 1) throw new Error('Plugin archive must contain exactly one plugin.json.');
  const prefix = manifests[0].slice(0, -'plugin.json'.length);
  const manifest = PluginManifestSchema.parse(JSON.parse(files[manifests[0]]));
  return parsePluginPackage({ manifest, files: Object.fromEntries(Object.entries(files).filter(([name]) => name.startsWith(prefix) && name !== manifests[0]).map(([name, content]) => [name.slice(prefix.length), content])) });
}
