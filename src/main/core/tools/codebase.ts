import fs from 'fs/promises';
import { Dirent } from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { z } from 'zod';
import type { ToolDefinition } from '../llm/types';
import { toolError, toolOk } from './result';
import type { PermissionGuard } from '../security/permissions';

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Ripgrep availability check (cached)
// ---------------------------------------------------------------------------
let _rgAvailable: boolean | null = null;

async function isRipgrepAvailable(): Promise<boolean> {
  if (_rgAvailable !== null) return _rgAvailable;
  try {
    await execFileAsync('rg', ['--version'], { timeout: 3000 });
    _rgAvailable = true;
  } catch {
    _rgAvailable = false;
  }
  return _rgAvailable;
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------
const DEFAULT_MAX_RESULTS = 250;
const MAX_FILE_SIZE_BYTES = 2 * 1024 * 1024; // 2 MB
const BINARY_EXTENSIONS = new Set([
  '.png','.jpg','.jpeg','.gif','.bmp','.ico','.webp','.svg',
  '.pdf','.doc','.docx','.xls','.xlsx','.ppt','.pptx',
  '.zip','.tar','.gz','.bz2','.xz','.7z','.rar',
  '.exe','.dll','.so','.dylib','.wasm',
  '.mp3','.mp4','.avi','.mov','.mkv','.flac','.wav',
  '.ttf','.otf','.woff','.woff2','.eot',
  '.o','.a','.class','.pyc','.pyo',
  '.db','.sqlite','.sqlite3',
  '.lockb','.snap',
]);

type FileTypeMap = Record<string, string[]>;
const FILE_TYPE_MAP: FileTypeMap = {
  js:   ['.js','.mjs','.cjs','.jsx'],
  ts:   ['.ts','.mts','.cts','.tsx'],
  py:   ['.py','.pyi','.pyx'],
  rust: ['.rs'],
  go:   ['.go'],
  java: ['.java','.kt','.scala'],
  json: ['.json','.jsonc','.json5'],
  md:   ['.md','.mdx'],
  css:  ['.css','.scss','.sass','.less'],
  html: ['.html','.htm'],
  vue:  ['.vue'],
  svelte: ['.svelte'],
  yaml: ['.yaml','.yml'],
  toml: ['.toml'],
  sh:   ['.sh','.bash','.zsh'],
};

function matchesFileType(filePath: string, type: string): boolean {
  const exts = FILE_TYPE_MAP[type];
  if (!exts) return true;
  const ext = path.extname(filePath).toLowerCase();
  return exts.includes(ext);
}

function matchesGlob(filePath: string, glob: string): boolean {
  // Convert glob to regex
  const regexStr = glob
    .replace(/\./g, '\\.')
    .replace(/\*\*\//g, '<<<GLOBSTAR>>>')
    .replace(/\*/g, '[^/]*')
    .replace(/<<<GLOBSTAR>>>/g, '.*')
    .replace(/\?/g, '[^/]')
    .replace(/\[!/g, '[^');
  try {
    return new RegExp(`^${regexStr}$`).test(filePath);
  } catch {
    return true;
  }
}

function isBinaryFile(ext: string): boolean {
  return BINARY_EXTENSIONS.has(ext.toLowerCase());
}

// Recursively collect files, respecting binary/text and glob/type filters
async function collectFiles(
  dir: string,
  options: { glob?: string; type?: string; maxFiles?: number },
  relativeRoot: string = dir,
  results: string[] = [],
  canRead?: (target: string) => boolean
): Promise<string[]> {
  if ((canRead && !canRead(dir)) || results.length >= (options.maxFiles ?? 10000)) return results;
  let entries: Dirent[];
  try {
    const stat = await fs.stat(dir);
    if (stat.isFile()) {
      const relativePath = path.relative(relativeRoot, dir) || path.basename(dir);
      if (!isBinaryFile(path.extname(dir))
        && (!options.glob || matchesGlob(relativePath, options.glob))
        && (!options.type || matchesFileType(dir, options.type))) results.push(dir);
      return results;
    }
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.') && entry.name !== '.') continue;
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    const fullPath = path.join(dir, entry.name);
    if (canRead && !canRead(fullPath)) continue;
    if (entry.isDirectory()) {
      await collectFiles(fullPath, options, relativeRoot, results, canRead);
    } else if (entry.isFile()) {
      if (isBinaryFile(path.extname(entry.name))) continue;
      const relPath = path.relative(relativeRoot, fullPath);
      if (options.glob && !matchesGlob(relPath, options.glob)) continue;
      if (options.type && !matchesFileType(fullPath, options.type)) continue;
      results.push(fullPath);
    }
    if (results.length >= (options.maxFiles ?? 10000)) break;
  }
  return results;
}

// ---------------------------------------------------------------------------
// Native (Node.js) grep fallback
// ---------------------------------------------------------------------------
interface GrepMatch {
  file: string;
  line: number;
  content: string;
}

async function nativeGrep(
  rootDir: string,
  pattern: string,
  options: {
    glob?: string;
    type?: string;
    caseInsensitive?: boolean;
    multiline?: boolean;
    headLimit?: number;
    canRead?: (target: string) => boolean;
  }
): Promise<GrepMatch[]> {
  const flags = options.caseInsensitive ? 'iu' : 'u';
  const effectiveFlags = options.multiline ? flags + 'gms' : flags;
  let regex: RegExp;
  try {
    regex = new RegExp(pattern, effectiveFlags);
  } catch {
    throw new Error(`Invalid regex pattern: ${pattern}`);
  }

  const files = await collectFiles(rootDir, {
    glob: options.glob,
    type: options.type,
  }, rootDir, [], options.canRead);
  const results: GrepMatch[] = [];
  const limit = options.headLimit ?? DEFAULT_MAX_RESULTS;

  for (const file of files) {
    if (results.length >= limit) break;
    let stat: { size: number };
    try {
      stat = await fs.stat(file);
    } catch {
      continue;
    }
    if (stat.size > MAX_FILE_SIZE_BYTES) continue;

    let content: string;
    try {
      content = await fs.readFile(file, 'utf-8');
    } catch {
      continue;
    }

    const lines = content.split('\n');
    if (options.multiline) {
      const lineStarts: number[] = [];
      let offset = 0;
      for (const line of lines) {
        lineStarts.push(offset);
        offset += line.length + 1;
      }
      let firstLine = 0;
      let lastEmittedLine = -1;
      // matchAll advances past zero-length matches, including Unicode characters.
      for (const match of content.matchAll(regex)) {
        while (firstLine + 1 < lines.length && lineStarts[firstLine + 1] <= match.index) firstLine++;
        const end = match.index + Math.max(0, match[0].length - 1);
        for (let line = firstLine; line < lines.length && lineStarts[line] <= end; line++) {
          if (line <= lastEmittedLine) continue;
          results.push({ file, line: line + 1, content: lines[line] });
          lastEmittedLine = line;
          if (results.length >= limit) break;
        }
        if (results.length >= limit) break;
      }
      continue;
    }
    for (let i = 0; i < lines.length; i++) {
      if (results.length >= limit) break;
      if (regex.test(lines[i])) {
        results.push({ file, line: i + 1, content: lines[i] });
      }
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Ripgrep-backed grep
// ---------------------------------------------------------------------------
async function ripgrepGrep(
  rootDir: string,
  pattern: string,
  options: {
    glob?: string;
    type?: string;
    caseInsensitive?: boolean;
    multiline?: boolean;
    headLimit?: number;
    contextBefore?: number;
    contextAfter?: number;
    context?: number;
  }
): Promise<GrepMatch[]> {
  const args: string[] = ['--no-heading', '--with-filename', '--line-number'];
  if (options.caseInsensitive) args.push('-i');
  if (options.multiline) args.push('--multiline', '--multiline-dotall');
  if (options.glob) args.push('--glob', options.glob);
  if (options.type) args.push('--type', options.type);
  if (options.contextBefore) args.push('-B', String(options.contextBefore));
  if (options.contextAfter) args.push('-A', String(options.contextAfter));
  if (options.context) args.push('-C', String(options.context));
  args.push('--', pattern, rootDir);

  const { stdout } = await execFileAsync('rg', args, {
    timeout: 30000,
    maxBuffer: 50 * 1024 * 1024,
  });

  const results: GrepMatch[] = [];
  const lines = stdout.trim().split('\n');
  for (const line of lines) {
    if (!line) continue;
    // rg format: "file:line:content" or "file-line-content" with --no-heading
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    const file = line.slice(0, colonIdx);
    const rest = line.slice(colonIdx + 1);
    const lineNumIdx = rest.indexOf(':');
    if (lineNumIdx === -1) continue;
    const lineNum = parseInt(rest.slice(0, lineNumIdx), 10);
    const content = rest.slice(lineNumIdx + 1);
    if (!isNaN(lineNum)) {
      results.push({ file, line: lineNum, content });
    }
  }

  const limit = options.headLimit ?? DEFAULT_MAX_RESULTS;
  return results.slice(0, limit);
}

// ---------------------------------------------------------------------------
// GrepTool
// ---------------------------------------------------------------------------
const grepParamsSchema = z.object({
  pattern: z.string().describe('The regular expression pattern to search for in file contents.'),
  path: z.string().optional().describe('File or directory to search in. Defaults to current working directory.'),
  glob: z.string().optional().describe('Glob pattern to filter files (e.g. "*.js", "*.{ts,tsx}").'),
  output_mode: z.enum(['content', 'files_with_matches', 'count']).optional().default('files_with_matches').describe('Output mode.'),
  '-A': z.number().int().min(0).optional().describe('Number of lines to show after each match.'),
  '-B': z.number().int().min(0).optional().describe('Number of lines to show before each match.'),
  '-C': z.number().int().min(0).optional().describe('Number of lines to show before and after each match.'),
  '-n': z.boolean().optional().default(true).describe('Show line numbers in output.'),
  '-i': z.boolean().optional().describe('Case insensitive search.'),
  type: z.string().optional().describe('File type to search (e.g. "js", "py", "ts", "rust").'),
  head_limit: z.number().int().min(0).optional().describe('Limit output to first N entries.'),
  multiline: z.boolean().optional().describe('Enable multiline mode for cross-line patterns.'),
});

async function grepExecute(rawArgs: Record<string, unknown>, canRead?: (target: string) => boolean) {
  const args = grepParamsSchema.parse(rawArgs);
  const searchPath = args.path ? path.resolve(args.path as string) : process.cwd();
  const effectiveLimit = args.head_limit && args.head_limit > 0 ? args.head_limit : DEFAULT_MAX_RESULTS;

  let matches: GrepMatch[];
  const grepOptions = {
    glob: args.glob,
    type: args.type,
    caseInsensitive: args['-i'] ?? false,
    multiline: args.multiline ?? false,
    headLimit: effectiveLimit,
    contextBefore: args['-B'],
    contextAfter: args['-A'],
    context: args['-C'],
    canRead,
  };

  if (!canRead && await isRipgrepAvailable()) {
    try {
      matches = await ripgrepGrep(searchPath, args.pattern, grepOptions);
    } catch (err) {
      // Fallback to native on rg failure
      matches = await nativeGrep(searchPath, args.pattern, grepOptions);
    }
  } else {
    matches = await nativeGrep(searchPath, args.pattern, grepOptions);
  }

  if (args.output_mode === 'count') {
    const counts = new Map<string, number>();
    for (const m of matches) {
      counts.set(m.file, (counts.get(m.file) ?? 0) + 1);
    }
    const lines: string[] = [];
    for (const [file, count] of counts) {
      lines.push(`${file}: ${count}`);
    }
    return toolOk({ matches: lines.slice(0, effectiveLimit) });
  }

  if (args.output_mode === 'files_with_matches') {
    const seen = new Set<string>();
    const files: string[] = [];
    for (const m of matches) {
      if (!seen.has(m.file)) {
        seen.add(m.file);
        files.push(m.file);
      }
    }
    return toolOk({ matches: files.slice(0, effectiveLimit) });
  }

  // content mode
  const showLineNumbers = args['-n'] !== false;
  const lines = matches.map((m) => {
    const prefix = showLineNumbers ? `${m.file}:${m.line}: ` : `${m.file}: `;
    return prefix + m.content;
  });
  return toolOk({ matches: lines.slice(0, effectiveLimit) });
}

export const GrepTool: ToolDefinition = {
  name: 'grep',
  description:
    'A powerful search tool built on ripgrep. Search specific text (in the pattern parameter) in a specific file or directory.\n\n' +
    'Usage:\n' +
    '- Prefer grep for exact symbol/string searches. Whenever possible, use this instead of terminal grep/rg. This tool is faster and respects .gitignore.\n' +
    '- Supports full regex syntax, e.g. "log.*Error", "function\\s+\\w+".\n' +
    '- Supports file type filtering, context lines.\n' +
    '- CRITICAL: directory MUST be an absolute path, relative paths are not accepted.\n' +
    '- CRITICAL: parameter "pattern" is required and must be returned before other parameters.',
  parameters: grepParamsSchema,
  execute: (args) => grepExecute(args),
  metadata: { source: 'builtin', riskLevel: 'low' },
};

// ---------------------------------------------------------------------------
// GlobTool
// ---------------------------------------------------------------------------
const globParamsSchema = z.object({
  pattern: z.string().describe('The glob pattern to match files against. Supports ** for recursive matching.'),
  path: z.string().optional().describe('The directory to search in. Defaults to current working directory.'),
});

async function globExecute(rawArgs: Record<string, unknown>, canRead?: (target: string) => boolean) {
  const args = globParamsSchema.parse(rawArgs);
  const searchPath = args.path ? path.resolve(args.path as string) : process.cwd();

  let stat: { isDirectory: () => boolean };
  try {
    stat = await fs.stat(searchPath);
  } catch {
    return toolError(`Path does not exist: ${searchPath}`);
  }
  if (!stat.isDirectory()) {
    return toolError(`Path is not a directory: ${searchPath}`);
  }

  const files = await collectFiles(searchPath, {
    glob: args.pattern,
    maxFiles: 5000,
  }, searchPath, [], canRead);

  // Sort by modification time (newest first)
  const withStats: { file: string; mtime: number }[] = [];
  for (const file of files.slice(0, 1000)) {
    try {
      const s = await fs.stat(file);
      withStats.push({ file, mtime: s.mtimeMs });
    } catch {
      withStats.push({ file, mtime: 0 });
    }
  }
  withStats.sort((a, b) => b.mtime - a.mtime);

  const result = withStats.map((e) => e.file).slice(0, DEFAULT_MAX_RESULTS);
  return toolOk({ matches: result });
}

export const GlobTool: ToolDefinition = {
  name: 'glob',
  description:
    'Fast file pattern matching tool that works with any codebase size.\n' +
    '- Supports glob patterns like "**/*.js" or "src/**/*.ts".\n' +
    '- Returns matching file paths sorted by modification time.\n' +
    '- Use this tool when you need to find files by name patterns.\n' +
    '- CRITICAL: directory MUST be an absolute path, relative paths are not accepted.',
  parameters: globParamsSchema,
  execute: (args) => globExecute(args),
  metadata: { source: 'builtin', riskLevel: 'low' },
};

// ---------------------------------------------------------------------------
// EditTool
// ---------------------------------------------------------------------------
const editParamsSchema = z.object({
  file_path: z.string().describe('The absolute path to the file to modify.'),
  old_string: z.string().describe('The text to replace. Must be unique in the file (unless replace_all is true).'),
  new_string: z.string().describe('The text to replace it with (must be different from old_string).'),
  replace_all: z.boolean().optional().default(false).describe('Replace all occurrences of old_string.'),
});

async function editExecute(rawArgs: Record<string, unknown>) {
  const args = editParamsSchema.parse(rawArgs);
  const filePath = path.resolve(args.file_path as string);

  if (args.old_string === args.new_string) {
    return toolError('old_string and new_string must be different.');
  }

  let content: string;
  try {
    content = await fs.readFile(filePath, 'utf-8');
  } catch (err) {
    return toolError(`Failed to read file: ${err instanceof Error ? err.message : 'Unknown error'}`);
  }

  if (!args.old_string) {
    return toolError('old_string must not be empty.');
  }

  const occurrences = content.split(args.old_string).length - 1;

  if (occurrences === 0) {
    return toolError(`old_string not found in file: "${args.old_string.slice(0, 80)}${args.old_string.length > 80 ? '...' : ''}"`);
  }

  if (occurrences > 1 && !args.replace_all) {
    return toolError(
      `old_string matches ${occurrences} times in the file. Use replace_all:true to replace all occurrences, or provide a larger string with more surrounding context to make it unique.`
    );
  }

  const newContent = args.replace_all
    ? content.split(args.old_string).join(args.new_string)
    : content.replace(args.old_string, () => args.new_string);

  try {
    await fs.writeFile(filePath, newContent, 'utf-8');
  } catch (err) {
    return toolError(`Failed to write file: ${err instanceof Error ? err.message : 'Unknown error'}`);
  }

  return toolOk({
    success: true,
    occurrences: args.replace_all ? occurrences : 1,
  });
}

export const EditTool: ToolDefinition = {
  name: 'edit_file',
  description:
    'Performs exact string replacements in files.\n\n' +
    'Usage:\n' +
    '- When editing text, ensure you preserve the exact indentation (tabs/spaces) as it appears before.\n' +
    '- ALWAYS prefer editing existing files in the codebase. NEVER write new files unless explicitly required.\n' +
    '- The edit will FAIL if old_string is not unique in the file.\n' +
    '  * Either provide a larger string with more surrounding context to make it unique.\n' +
    '- Use replace_all for replacing and renaming strings across the file.\n\n' +
    'CRITICAL: old_string must include all whitespace, indentation, blank lines, and surrounding code exactly as it appears in the file.',
  parameters: editParamsSchema,
  execute: (args) => editExecute(args),
  metadata: { source: 'builtin', riskLevel: 'high' },
};

// Runtime instances get explicit roots and per-file checks; searches never fall back to the app cwd.
export function createCodebaseTools(workspace: string, guard: PermissionGuard): ToolDefinition[] {
  const canRead = (target: string) => guard.checkFileSystem(target, 'read');
  return [
    { ...GrepTool, execute: (args) => grepExecute({ ...args, path: args.path || workspace }, canRead) },
    { ...GlobTool, execute: (args) => globExecute({ ...args, path: args.path || workspace }, canRead) },
    EditTool
  ];
}
