import { ipcMain, dialog } from 'electron';
import os from 'os';
import { spawn } from 'child_process';
import { KAIRO_EVENT, KAIRO_INVOKE } from '../../shared/ipc';

let previousCpus = os.cpus();

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

  ipcMain.handle(KAIRO_INVOKE.ollamaCheck, async (_, baseUrl: string) => {
    try {
      const url = baseUrl || 'http://localhost:11434';
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
        resolve({ success: false, error: err.message });
      });

      child.unref();

      setTimeout(() => {
        resolve({ success: true });
      }, 2000);
    });
  });

  ipcMain.handle(KAIRO_INVOKE.ollamaPull, async (event, { baseUrl, modelName }) => {
    try {
      const url = `${baseUrl || 'http://localhost:11434'}/api/pull`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: modelName })
      });

      if (!response.ok) {
        return { success: false, error: `Failed to pull: ${response.statusText}` };
      }

      if (!response.body) {
        return { success: false, error: 'No response body' };
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

      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });
}

export { registerSystemHandlers };
