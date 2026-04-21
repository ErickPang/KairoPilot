import { z } from 'zod';
import { ToolDefinition } from '../llm/types';
import os from 'os';
import { toolError, toolOk } from './result';

export const SystemInfoTool: ToolDefinition = {
  name: 'system_info',
  description: 'Get system information including platform, architecture, CPUs, and memory usage.',
  parameters: z.object({}),
  execute: async () => {
    try {
      const cpus = os.cpus();
      const totalMem = os.totalmem();
      const freeMem = os.freemem();
      const platform = os.platform();
      const release = os.release();
      const uptime = os.uptime();
      
      return toolOk({
        platform,
        release,
        arch: os.arch(),
        cpuModel: cpus[0]?.model || 'Unknown',
        cpuCount: cpus.length,
        totalMemory: `${(totalMem / (1024 * 1024 * 1024)).toFixed(2)} GB`,
        freeMemory: `${(freeMem / (1024 * 1024 * 1024)).toFixed(2)} GB`,
        uptime: `${(uptime / 3600).toFixed(2)} hours`
      });
    } catch (error) {
      return toolError(`Failed to get system info: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  },
};
