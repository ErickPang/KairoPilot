import { ipcMain, dialog } from 'electron';
import os from 'os';
import fs from 'fs/promises';
import path from 'path';
import { spawn } from 'child_process';
import { KAIRO_EVENT, KAIRO_INVOKE } from '../../../shared/ipc';
import { parseIpcInput } from './configValidation';
import {
  OllamaBaseUrlInputSchema,
  OllamaPullInputSchema,
  OllamaDeleteModelSchema,
  OllamaListModelsSchema,
  SelectFileInputSchema
} from './chatSystemValidation';
import { ipcFailure, ipcSuccess } from './ipcResult';
import { requireActiveSessionPath } from '../../services/projectService';

let previousCpus = os.cpus();

const TEXT_PREVIEW_EXTENSIONS = new Set([
  'txt', 'md', 'mdx', 'json', 'js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs',
  'css', 'scss', 'html', 'htm', 'xml', 'yml', 'yaml', 'toml', 'ini',
  'py', 'rs', 'go', 'java', 'kt', 'swift', 'sh', 'bash', 'zsh', 'sql',
  'env', 'gitignore', 'log'
]);

const IMAGE_PREVIEW_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg']);

function registerSystemHandlers() {
  ipcMain.handle(KAIRO_INVOKE.systemStats, async () => {
    const currentCpus = os.cpus();
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const uptime = os.uptime();
    let totalIdle = 0;
    let totalTick = 0;

    currentCpus.forEach((cpu, i) => {
      const prevCpu = previousCpus[i];
      if (prevCpu) {
        let type: keyof typeof cpu.times;
        for (type in cpu.times) {
          totalTick += cpu.times[type] - prevCpu.times[type];
        }
        totalIdle += cpu.times.idle - prevCpu.times.idle;
      }
    });

    const cpuUsage = totalTick > 0 ? Math.round(((totalTick - totalIdle) / totalTick) * 100) : 0;
    previousCpus = currentCpus;

    return {
      platform: os.platform(),
      arch: os.arch(),
      cpuModel: currentCpus[0]?.model || 'Unknown',
      cpuUsage,
      memoryUsage: Math.round(((totalMem - freeMem) / totalMem) * 100),
      totalMemory: (totalMem / (1024 * 1024 * 1024)).toFixed(1),
      uptime: Math.floor(uptime / 3600)
    };
  });

  ipcMain.handle(KAIRO_INVOKE.systemSelectDirectory, async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      properties: ['openDirectory']
    });
    if (canceled) {
      return null;
    }
    return filePaths[0];
  });

  ipcMain.handle(KAIRO_INVOKE.systemSelectFile, async (_, args) => {
    const payload = parseIpcInput(SelectFileInputSchema, args, 'file selection options');
    const { canceled, filePaths } = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: payload?.filters
    });
    if (canceled) {
      return null;
    }
    return filePaths[0];
  });

  ipcMain.handle(KAIRO_INVOKE.systemSelectFiles, async (_, args) => {
    const payload = parseIpcInput(SelectFileInputSchema, args, 'file selection options');
    const { canceled, filePaths } = await dialog.showOpenDialog({
      properties: ['openFile', 'multiSelections'],
      filters: payload?.filters
    });
    if (canceled) {
      return [];
    }
    return filePaths;
  });

  ipcMain.handle(KAIRO_INVOKE.ollamaCheck, async (_, baseUrl: string) => {
    try {
      const payload = parseIpcInput(OllamaBaseUrlInputSchema, baseUrl, 'Ollama base URL');
      const url = payload || 'http://localhost:11434';
      const response = await fetch(url);
      if (response.ok) {
        return { running: true, message: await response.text() };
      }
      return { running: false, error: `HTTP Status: ${response.status}` };
    } catch (error) {
      return { running: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  ipcMain.handle(KAIRO_INVOKE.ollamaStart, async () => {
    return new Promise((resolve) => {
      const child = spawn('ollama', ['serve'], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true
      });

      child.on('error', (err: Error) => {
        resolve(ipcFailure(err));
      });

      child.unref();

      setTimeout(() => {
        resolve(ipcSuccess());
      }, 2000);
    });
  });

  ipcMain.handle(KAIRO_INVOKE.ollamaPull, async (event, input) => {
    try {
      const payload = parseIpcInput(OllamaPullInputSchema, input, 'Ollama pull request');
      const { baseUrl, modelName } = payload;
      const url = `${baseUrl || 'http://localhost:11434'}/api/pull`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: modelName })
      });

      if (!response.ok) {
        return ipcFailure(`Failed to pull: ${response.statusText}`);
      }

      if (!response.body) {
        return ipcFailure('No response body');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      let isDone = false;
      while (!isDone) {
        const { value, done } = await reader.read();
        if (done) {
          isDone = true;
          continue;
        }
        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n').filter(line => line.trim() !== '');
        for (const line of lines) {
          try {
            const data = JSON.parse(line);
            event.sender.send(KAIRO_EVENT.ollamaPullProgress, data);
          } catch (_error) {
            continue;
          }
        }
      }

      return ipcSuccess();
    } catch (error) {
      return ipcFailure(error);
    }
  });

  ipcMain.handle(KAIRO_INVOKE.ollamaListModels, async (_, baseUrl: string) => {
    try {
      const payload = parseIpcInput(OllamaListModelsSchema, baseUrl, 'Ollama base URL');
      const url = `${payload || 'http://localhost:11434'}/api/tags`;
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to list models: ${response.statusText}`);
      }
      return response.json();
    } catch (error) {
      console.error('ollama:listModels error:', error);
      return { models: [] };
    }
  });

  ipcMain.handle(KAIRO_INVOKE.ollamaDeleteModel, async (_, input) => {
    try {
      const payload = parseIpcInput(OllamaDeleteModelSchema, input, 'Ollama delete request');
      const { baseUrl, modelName } = payload;
      const url = `${baseUrl || 'http://localhost:11434'}/api/delete`;
      const response = await fetch(url, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: modelName })
      });
      if (!response.ok) {
        return { success: false, error: `Failed to delete model: ${response.statusText}` };
      }
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  ipcMain.handle(KAIRO_INVOKE.systemListDirectory, async (_event, dirPath: string) => {
    try {
      const resolvedPath = path.resolve(typeof dirPath === 'string' ? dirPath : process.cwd());
      requireActiveSessionPath(resolvedPath);
      const entries = await fs.readdir(resolvedPath, { withFileTypes: true });
      const children = entries
        .filter((entry) => !entry.name.startsWith('.') || entry.name === '.gitignore')
        .map((entry) => ({
          name: entry.name,
          path: path.join(resolvedPath, entry.name),
          isDirectory: entry.isDirectory(),
        }))
        .sort((a, b) => {
          // Directories first, then alphabetical
          if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
          return a.name.localeCompare(b.name);
        });
      return { path: resolvedPath, children };
    } catch (err) {
      return { path: typeof dirPath === 'string' ? dirPath : process.cwd(), children: [], error: err instanceof Error ? err.message : 'Unknown error' };
    }
  });

  ipcMain.handle(KAIRO_INVOKE.systemReadFilePreview, async (_event, filePath: string) => {
    try {
      const resolvedPath = path.resolve(typeof filePath === 'string' ? filePath : process.cwd());
      requireActiveSessionPath(resolvedPath);
      const stats = await fs.stat(resolvedPath);
      const ext = path.extname(resolvedPath).slice(1).toLowerCase();
      const name = path.basename(resolvedPath);

      if (stats.isDirectory()) {
        return { kind: 'directory', path: resolvedPath, name, size: stats.size };
      }

      if (IMAGE_PREVIEW_EXTENSIONS.has(ext)) {
        if (stats.size > 10 * 1024 * 1024) return { kind: 'unsupported', path: resolvedPath, name, size: stats.size, extension: ext, reason: 'too_large' };
        return {
          kind: 'image',
          path: resolvedPath,
          name,
          size: stats.size,
          extension: ext
        };
      }

      if (!TEXT_PREVIEW_EXTENSIONS.has(ext) && ext !== '') {
        return {
          kind: 'unsupported',
          path: resolvedPath,
          name,
          size: stats.size,
          extension: ext
        };
      }

      const maxBytes = 200 * 1024;
      const handle = await fs.open(resolvedPath, 'r');
      const buffer = Buffer.alloc(maxBytes + 1);
      let bytesRead: number;
      try { ({ bytesRead } = await handle.read(buffer, 0, buffer.length, 0)); }
      finally { await handle.close(); }
      const bytes = buffer.subarray(0, Math.min(bytesRead, maxBytes));
      if (bytes.includes(0)) return { kind: 'unsupported', path: resolvedPath, name, size: stats.size, extension: ext, reason: 'binary' };
      const content = bytes.toString('utf8');
      const truncated = stats.size > maxBytes || bytesRead > maxBytes;
      return {
        kind: ext === 'md' || ext === 'mdx' ? 'markdown' : 'text',
        path: resolvedPath,
        name,
        size: stats.size,
        extension: ext || 'txt',
        content,
        truncated
      };
    } catch (err) {
      return {
        kind: 'error',
        path: typeof filePath === 'string' ? filePath : '',
        error: err instanceof Error ? err.message : 'Unknown error'
      };
    }
  });
}

export { registerSystemHandlers };
