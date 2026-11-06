import crypto from 'node:crypto';
import type Database from 'better-sqlite3';
import nodeFs from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { ChatAttachment, PrepareAttachmentInput } from '../../shared/contracts';

const TEXT_EXTENSIONS = new Set([
  '.txt', '.md', '.markdown', '.json', '.jsonl', '.csv', '.tsv', '.xml', '.html', '.htm',
  '.css', '.scss', '.less', '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.py', '.rb',
  '.go', '.rs', '.java', '.c', '.cc', '.cpp', '.h', '.hpp', '.cs', '.php', '.sh', '.bash',
  '.zsh', '.fish', '.yaml', '.yml', '.toml', '.ini', '.env', '.sql', '.log'
]);

const MIME_BY_EXTENSION: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.markdown': 'text/markdown',
  '.json': 'application/json',
  '.csv': 'text/csv',
  '.tsv': 'text/tab-separated-values',
  '.html': 'text/html',
  '.htm': 'text/html'
};

const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
const MAX_EXTRACTED_TEXT_CHARS = 16_000;
const MIME_SNIFF_BYTES = 8192;
const TEXT_PREVIEW_BYTES = 64 * 1024;
const DEFAULT_UPLOAD_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const CLEANUP_DEBOUNCE_MS = 30 * 1000;
const CLEANUP_MIN_INTERVAL_MS = 6 * 60 * 60 * 1000;

const MAX_STORED_FILENAME_BYTES = 180;

function basenameFromInput(name: string) {
  const fallback = 'attachment';
  const normalizedName = name || fallback;
  return normalizedName
    .split(/[\\/]+/)
    .filter(Boolean)
    .pop() || fallback;
}

function truncateUtf8ByBytes(value: string, maxBytes: number) {
  let result = '';
  let usedBytes = 0;
  for (const char of value) {
    const byteLength = Buffer.byteLength(char);
    if (usedBytes + byteLength > maxBytes) {
      break;
    }
    result += char;
    usedBytes += byteLength;
  }
  return result;
}

function stripControlCharacters(value: string) {
  return Array.from(value).filter((char) => {
    const codePoint = char.codePointAt(0) ?? 0;
    return codePoint > 31 && codePoint !== 127;
  }).join('');
}

function isUnsafeStoredFileNameChar(char: string) {
  return '<>:"/\\|?*'.includes(char);
}

function sanitizeDisplayFileName(name: string) {
  const fallback = 'attachment';
  const baseName = stripControlCharacters(basenameFromInput(name).normalize('NFC')).trim();
  return baseName || fallback;
}

function sanitizeStoredFileName(name: string) {
  const fallback = 'attachment';
  const displayName = sanitizeDisplayFileName(name);
  const safeName = Array.from(displayName)
    .map((char) => isUnsafeStoredFileNameChar(char) ? '_' : char)
    .join('')
    .replace(/\s+/g, ' ')
    .trim() || fallback;
  const extension = path.extname(safeName);
  const storedExtension = truncateUtf8ByBytes(extension, Math.max(0, MAX_STORED_FILENAME_BYTES - 16));
  const maxBaseBytes = Math.max(1, MAX_STORED_FILENAME_BYTES - Buffer.byteLength(storedExtension));
  const base = safeName.slice(0, safeName.length - extension.length) || fallback;
  return `${truncateUtf8ByBytes(base, maxBaseBytes)}${storedExtension}`;
}

function resolveMimeType(filePath: string, hintedMimeType?: string) {
  if (hintedMimeType && hintedMimeType.trim()) {
    return hintedMimeType.trim();
  }
  return MIME_BY_EXTENSION[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
}

function isLikelyTextBuffer(buffer: Buffer) {
  if (buffer.includes(0)) {
    return false;
  }
  const sample = buffer.subarray(0, Math.min(buffer.length, 4096));
  const decoded = sample.toString('utf-8');
  return !decoded.includes('\uFFFD');
}

function sniffMimeType(buffer: Buffer, filePath: string) {
  const ext = path.extname(filePath).toLowerCase();
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buffer.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return 'image/jpeg';
  if (buffer.subarray(0, 6).toString('ascii') === 'GIF87a' || buffer.subarray(0, 6).toString('ascii') === 'GIF89a') return 'image/gif';
  if (buffer.subarray(0, 2).toString('ascii') === 'BM') return 'image/bmp';
  if (buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  if (buffer.subarray(0, 5).toString('ascii') === '%PDF-') return 'application/pdf';
  if (isLikelyTextBuffer(buffer)) {
    const prefix = buffer.subarray(0, Math.min(buffer.length, 512)).toString('utf-8').trimStart().toLowerCase();
    if (ext === '.svg' || prefix.startsWith('<svg') || prefix.includes('<svg')) return 'image/svg+xml';
    return MIME_BY_EXTENSION[ext]?.startsWith('text/') || TEXT_EXTENSIONS.has(ext)
      ? MIME_BY_EXTENSION[ext] || 'text/plain'
      : 'text/plain';
  }
  return MIME_BY_EXTENSION[ext] || 'application/octet-stream';
}

function resolveVerifiedMimeType(filePath: string, buffer: Buffer, hintedMimeType?: string) {
  const extensionMimeType = resolveMimeType(filePath, hintedMimeType);
  const sniffedMimeType = sniffMimeType(buffer, filePath);
  const extensionKind = resolveKind(filePath, extensionMimeType);
  const sniffedKind = resolveKind(filePath, sniffedMimeType);

  if ((extensionKind === 'image' || extensionMimeType === 'application/pdf') && extensionKind !== sniffedKind) {
    throw new Error(`Attachment MIME mismatch: ${path.basename(filePath)} looks like ${sniffedMimeType}, not ${extensionMimeType}.`);
  }

  return sniffedMimeType;
}

function resolveKind(filePath: string, mimeType: string): ChatAttachment['kind'] {
  if (mimeType.startsWith('image/')) {
    return 'image';
  }
  if (mimeType.startsWith('text/') || TEXT_EXTENSIONS.has(path.extname(filePath).toLowerCase())) {
    return 'text';
  }
  return 'file';
}

async function readFileHeader(filePath: string, size: number, maxBytes = MIME_SNIFF_BYTES) {
  const readLength = Math.min(Math.max(size, 0), maxBytes);
  if (readLength <= 0) {
    return Buffer.alloc(0);
  }

  const handle = await fs.open(filePath, 'r');
  try {
    const buffer = Buffer.alloc(readLength);
    const result = await handle.read(buffer, 0, readLength, 0);
    return buffer.subarray(0, result.bytesRead);
  } finally {
    await handle.close();
  }
}

async function hashFile(filePath: string) {
  const hash = crypto.createHash('sha256');
  await new Promise<void>((resolve, reject) => {
    const stream = nodeFs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', resolve);
  });
  return hash.digest('hex');
}

async function copyFileStreaming(sourcePath: string, storedPath: string) {
  await pipeline(
    nodeFs.createReadStream(sourcePath),
    nodeFs.createWriteStream(storedPath, { flags: 'wx' })
  );
}

async function readTextPreview(filePath: string, size: number) {
  const buffer = await readFileHeader(filePath, size, TEXT_PREVIEW_BYTES);
  const content = buffer.toString('utf-8');
  const clippedContent = content.length > MAX_EXTRACTED_TEXT_CHARS
    ? content.slice(0, MAX_EXTRACTED_TEXT_CHARS)
    : content;

  if (buffer.length < size || content.length > MAX_EXTRACTED_TEXT_CHARS) {
    return `${clippedContent.trimEnd()}

[File preview truncated: ${size} bytes total]`;
  }
  return clippedContent;
}

export function buildAttachmentPreviewUri(storedPath: string) {
  return `kairopilot://${encodeURIComponent(storedPath)}`;
}

export function getSessionAttachmentUploadDir(workspace: string, sessionId: string) {
  return path.join(path.resolve(workspace), '.kairopilot', 'uploads', sessionId);
}

export function getWorkspaceAttachmentUploadsRoot(workspace: string) {
  return path.join(path.resolve(workspace), '.kairopilot', 'uploads');
}

export async function cleanupOldAttachmentFiles(workspace: string, maxAgeMs = DEFAULT_UPLOAD_RETENTION_MS) {
  const uploadsRoot = getWorkspaceAttachmentUploadsRoot(workspace);
  const cutoff = Date.now() - maxAgeMs;
  let removedFiles = 0;
  let removedDirs = 0;

  async function visit(directoryPath: string) {
    let entries: Array<import('node:fs').Dirent> = [];
    try {
      entries = await fs.readdir(directoryPath, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const entryPath = path.join(directoryPath, entry.name);
      if (entry.isDirectory()) {
        await visit(entryPath);
        try {
          await fs.rmdir(entryPath);
          removedDirs += 1;
        } catch {
          continue;
        }
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      try {
        const stats = await fs.stat(entryPath);
        if (stats.mtimeMs < cutoff) {
          await fs.unlink(entryPath);
          removedFiles += 1;
        }
      } catch {
        continue;
      }
    }
  }

  await visit(uploadsRoot);
  return { removedFiles, removedDirs };
}

type CleanupState = {
  lastStartedAt: number;
  timer?: NodeJS.Timeout;
  running: boolean;
};

const cleanupStates = new Map<string, CleanupState>();

export function scheduleAttachmentCleanup(workspace: string, maxAgeMs = DEFAULT_UPLOAD_RETENTION_MS) {
  const normalizedWorkspace = path.resolve(workspace);
  const existing = cleanupStates.get(normalizedWorkspace);
  const now = Date.now();

  if (existing?.timer || existing?.running) {
    return { scheduled: false, reason: 'already_scheduled' };
  }

  if (existing && now - existing.lastStartedAt < CLEANUP_MIN_INTERVAL_MS) {
    return { scheduled: false, reason: 'recently_cleaned' };
  }

  const state: CleanupState = existing || { lastStartedAt: 0, running: false };
  state.timer = setTimeout(() => {
    state.timer = undefined;
    state.running = true;
    state.lastStartedAt = Date.now();
    void cleanupOldAttachmentFiles(normalizedWorkspace, maxAgeMs)
      .catch((error) => {
        console.warn(`[Attachments] Failed to cleanup uploads for ${normalizedWorkspace}:`, error);
      })
      .finally(() => {
        state.running = false;
      });
  }, CLEANUP_DEBOUNCE_MS);
  state.timer.unref?.();
  cleanupStates.set(normalizedWorkspace, state);

  return { scheduled: true, reason: 'scheduled' };
}

export async function deleteSessionAttachmentFiles(workspace: string, sessionId: string) {
  const sessionUploadDir = getSessionAttachmentUploadDir(workspace, sessionId);
  await fs.rm(sessionUploadDir, { recursive: true, force: true });
}

export function formatAttachmentContext(attachments: ChatAttachment[]) {
  if (attachments.length === 0) {
    return '';
  }

  const sections = attachments.map((attachment, index) => {
    const header = [
      `Attachment ${index + 1}: ${attachment.name}`,
      `- attachmentId: ${attachment.id}`,
      `- type: ${attachment.mimeType}`,
      `- size: ${attachment.size} bytes`,
      `- storedPath: ${attachment.storedPath}`,
      `- read_tool: read_attachment({"attachmentId":"${attachment.id}"})`
    ].join('\n');

    if (attachment.kind === 'text' && attachment.extractedText) {
      return `${header}\n- extractedText:\n\`\`\`\n${attachment.extractedText}\n\`\`\``;
    }

    if (attachment.kind === 'image') {
      return `${header}\n- note: Image content is attached as multimodal input when the selected model supports it. Use read_attachment for metadata; only use read_file with storedPath if an explicit file path is required.`;
    }

    return `${header}\n- note: Prefer read_attachment with attachmentId. Use read_file with storedPath only as a fallback when the attachment is textual and read_attachment is insufficient.`;
  });

  return `<attachments>\nWhen inspecting uploaded files, prefer the read_attachment tool with attachmentId because it is scoped to this chat session. Do not ask the user for these files again unless read_attachment reports they are unavailable.\n\n${sections.join('\n\n')}\n</attachments>`;
}

export async function prepareChatAttachments(params: {
  sessionId: string;
  workspace: string;
  files: PrepareAttachmentInput[];
}): Promise<ChatAttachment[]> {
  const sessionId = params.sessionId.trim();
  if (!sessionId) {
    throw new Error('sessionId is required.');
  }

  const workspace = path.resolve(params.workspace);
  const uploadDir = getSessionAttachmentUploadDir(workspace, sessionId);
  await fs.mkdir(uploadDir, { recursive: true });

  const attachments: ChatAttachment[] = [];
  for (const file of params.files) {
    const sourcePath = path.resolve(file.path || '');
    const stats = await fs.stat(sourcePath);
    if (!stats.isFile()) {
      throw new Error(`Attachment is not a file: ${sourcePath}`);
    }
    if (stats.size > MAX_ATTACHMENT_BYTES) {
      throw new Error(`Attachment exceeds ${Math.floor(MAX_ATTACHMENT_BYTES / 1024 / 1024)}MB: ${path.basename(sourcePath)}`);
    }

    const sniffBuffer = await readFileHeader(sourcePath, stats.size);
    const mimeType = resolveVerifiedMimeType(sourcePath, sniffBuffer, file.mimeType);
    const contentHash = await hashFile(sourcePath);
    const originalName = sanitizeDisplayFileName(file.name || path.basename(sourcePath));
    const attachmentId = crypto.randomUUID();
    const storedName = `${Date.now()}-${contentHash.slice(0, 12)}-${attachmentId.slice(0, 8)}-${sanitizeStoredFileName(originalName)}`;
    const storedPath = path.join(uploadDir, storedName);
    await copyFileStreaming(sourcePath, storedPath);

    const kind = resolveKind(sourcePath, mimeType);
    const attachment: ChatAttachment = {
      id: attachmentId,
      sessionId,
      name: originalName,
      mimeType,
      size: stats.size,
      kind,
      originalPath: sourcePath,
      storedPath,
      contentHash,
      previewUri: buildAttachmentPreviewUri(storedPath),
      createdAt: Date.now()
    };

    if (kind === 'text') {
      try {
        attachment.extractedText = await readTextPreview(storedPath, stats.size);
      } catch {
        attachment.kind = 'file';
      }
    }

    attachments.push(attachment);
  }

  return attachments;
}

export function mapAttachmentRow(row: Record<string, unknown>): ChatAttachment {
  return {
    id: String(row.id || ''),
    sessionId: String(row.session_id || ''),
    name: String(row.name || 'attachment'),
    mimeType: String(row.mime_type || 'application/octet-stream'),
    size: Number(row.size || 0),
    kind: row.kind === 'image' || row.kind === 'text' || row.kind === 'file' ? row.kind : 'file',
    originalPath: typeof row.original_path === 'string' ? row.original_path : undefined,
    storedPath: String(row.stored_path || ''),
    contentHash: String(row.content_hash || ''),
    previewUri: typeof row.preview_uri === 'string' ? row.preview_uri : undefined,
    extractedText: typeof row.extracted_text === 'string' ? row.extracted_text : undefined,
    createdAt: Number(row.created_at || Date.now())
  };
}

export function getAttachmentById(database: Database.Database, attachmentId: string, sessionId?: string | null) {
  const row = sessionId
    ? database.prepare('SELECT * FROM message_attachments WHERE id = ? AND session_id = ?').get(attachmentId, sessionId)
    : database.prepare('SELECT * FROM message_attachments WHERE id = ?').get(attachmentId);
  return row ? mapAttachmentRow(row as Record<string, unknown>) : null;
}

export async function deleteAttachmentFile(attachment: ChatAttachment) {
  try {
    await fs.unlink(attachment.storedPath);
    return true;
  } catch {
    return false;
  }
}
