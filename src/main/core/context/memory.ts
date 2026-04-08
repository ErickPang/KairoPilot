import fs from 'fs';
import path from 'path';
import { getPromptWorkspaceLayout } from '../../workspace/layout';

function trimText(value: string, maxChars: number) {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxChars) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
}

function readFileIfExists(filePath: string) {
  if (!fs.existsSync(filePath)) {
    return '';
  }

  try {
    return fs.readFileSync(filePath, 'utf-8').trim();
  } catch {
    return '';
  }
}

function readMarkdownDirectory(directoryPath: string) {
  if (!fs.existsSync(directoryPath)) {
    return [];
  }

  try {
    return fs.readdirSync(directoryPath, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.md'))
      .sort((left, right) => left.name.localeCompare(right.name))
      .map((entry) => {
        const filePath = path.join(directoryPath, entry.name);
        return {
          name: entry.name,
          content: readFileIfExists(filePath)
        };
      })
      .filter((entry) => entry.content.length > 0);
  } catch {
    return [];
  }
}

function readTextFiles(directoryPath: string, extensions: string[], maxEntries: number) {
  if (!fs.existsSync(directoryPath)) {
    return [];
  }

  try {
    return fs.readdirSync(directoryPath, { withFileTypes: true })
      .filter((entry) => entry.isFile() && extensions.some((extension) => entry.name.toLowerCase().endsWith(extension)))
      .sort((left, right) => left.name.localeCompare(right.name))
      .slice(0, maxEntries)
      .map((entry) => {
        const filePath = path.join(directoryPath, entry.name);
        return {
          name: entry.name,
          content: readFileIfExists(filePath)
        };
      })
      .filter((entry) => entry.content.length > 0);
  } catch {
    return [];
  }
}

function collectFileTree(rootPath: string, maxEntries: number, depth = 2, prefix = ''): string[] {
  if (!fs.existsSync(rootPath) || maxEntries <= 0) {
    return [];
  }

  try {
    const entries = fs.readdirSync(rootPath, { withFileTypes: true })
      .filter((entry) => !entry.name.startsWith('.'))
      .sort((left, right) => {
        if (left.isDirectory() !== right.isDirectory()) {
          return left.isDirectory() ? -1 : 1;
        }
        return left.name.localeCompare(right.name);
      });

    const lines: string[] = [];
    for (const entry of entries) {
      if (lines.length >= maxEntries) {
        break;
      }
      lines.push(`${prefix}${entry.isDirectory() ? '[dir]' : '[file]'} ${entry.name}`);
      if (entry.isDirectory() && depth > 0 && lines.length < maxEntries) {
        const childLines = collectFileTree(path.join(rootPath, entry.name), maxEntries - lines.length, depth - 1, `${prefix}  `);
        lines.push(...childLines);
      }
    }
    return lines;
  } catch {
    return [];
  }
}

function describeDirectory(directoryPath: string, maxEntries: number) {
  if (!fs.existsSync(directoryPath)) {
    return '';
  }

  try {
    const entries = fs.readdirSync(directoryPath, { withFileTypes: true })
      .filter((entry) => !entry.name.startsWith('.'))
      .sort((left, right) => left.name.localeCompare(right.name))
      .slice(0, maxEntries)
      .map((entry) => `${entry.isDirectory() ? '[dir]' : '[file]'} ${entry.name}`);

    return entries.join('\n');
  } catch {
    return '';
  }
}

export function buildMemoryDigest(workspace: string, maxChars: number, episodicMemory = '') {
  if (!workspace || maxChars <= 0) {
    return '';
  }

  const layout = getPromptWorkspaceLayout(workspace);
  const sections: string[] = [];
  const rootMemory = readFileIfExists(layout.memoryFile);

  if (rootMemory) {
    sections.push(`<workspace_memory>\n${trimText(rootMemory, Math.min(2400, maxChars))}\n</workspace_memory>`);
  }

  const memoryNotes = readMarkdownDirectory(layout.memoryDir);
  if (memoryNotes.length > 0) {
    const rendered = memoryNotes
      .slice(0, 6)
      .map((entry) => `- ${entry.name}: ${trimText(entry.content, 260)}`)
      .join('\n');
    sections.push(`<memory_notes_digest>\n${rendered}\n</memory_notes_digest>`);
  }

  const promptNotes = readMarkdownDirectory(layout.promptsDir);
  if (promptNotes.length > 0) {
    const rendered = promptNotes
      .slice(0, 6)
      .map((entry) => `- ${entry.name}: ${trimText(entry.content, 260)}`)
      .join('\n');
    sections.push(`<workspace_prompt_digest>\n${rendered}\n</workspace_prompt_digest>`);
  }

  if (episodicMemory.trim()) {
    sections.push(`<episodic_memory>\n${trimText(episodicMemory, 1400)}\n</episodic_memory>`);
  }

  return trimText(sections.join('\n\n'), maxChars);
}

export function buildWorkspaceRetrievalDigest(workspace: string, maxChars: number) {
  if (!workspace || maxChars <= 0) {
    return '';
  }

  const layout = getPromptWorkspaceLayout(workspace);
  const sections: string[] = [];
  const rootListing = describeDirectory(layout.workspaceRoot, 18);
  const taskListing = describeDirectory(layout.tasksDir, 8);
  const artifactListing = describeDirectory(layout.artifactsDir, 8);
  const fileTree = collectFileTree(layout.workspaceRoot, 28, 2).join('\n');
  const docsIndex = readTextFiles(layout.promptsDir, ['.md', '.txt'], 6)
    .concat(readTextFiles(layout.tasksDir, ['.md', '.txt'], 6))
    .slice(0, 8);
  const symbolIndex = readTextFiles(layout.workspaceRoot, ['.ts', '.tsx', '.js', '.jsx'], 8)
    .map((entry) => {
      const symbols = entry.content
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => /^(export\s+)?(async\s+)?function\s+\w+|^export\s+(const|class)\s+\w+|^class\s+\w+|^interface\s+\w+|^type\s+\w+/.test(line))
        .slice(0, 5)
        .join(' | ');
      return symbols ? `- ${entry.name}: ${trimText(symbols, 240)}` : '';
    })
    .filter(Boolean)
    .join('\n');

  if (rootListing) {
    sections.push(`<workspace_root_listing>\n${rootListing}\n</workspace_root_listing>`);
  }

  if (fileTree) {
    sections.push(`<workspace_file_tree>\n${fileTree}\n</workspace_file_tree>`);
  }

  if (taskListing) {
    sections.push(`<tasks_listing>\n${taskListing}\n</tasks_listing>`);
  }

  if (artifactListing) {
    sections.push(`<artifacts_listing>\n${artifactListing}\n</artifacts_listing>`);
  }

  if (docsIndex.length > 0) {
    sections.push(`<docs_index>\n${docsIndex.map((entry) => `- ${entry.name}: ${trimText(entry.content, 220)}`).join('\n')}\n</docs_index>`);
  }

  if (symbolIndex) {
    sections.push(`<symbol_index>\n${symbolIndex}\n</symbol_index>`);
  }

  return trimText(sections.join('\n\n'), maxChars);
}
