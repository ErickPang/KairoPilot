import { z } from 'zod';
import { ToolDefinition } from '../llm/types';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export const createExecuteCommandTool = (cwd: string): ToolDefinition => ({
  name: 'execute_command',
  description: `Execute a shell command in the current workspace (${cwd}). Use this to run system commands, install packages, or manage processes. Only use for non-interactive commands.`,
  parameters: z.object({
    command: z.string().describe('The shell command to execute'),
  }),
  execute: async (args: Record<string, unknown>) => {
    try {
      const command = args.command as string;
      console.log(`Executing command: ${command} in ${cwd}`);
      const { stdout, stderr } = await execAsync(command, { cwd });
      return {
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        exitCode: 0
      };
    } catch (error) {
      const err = error as { stdout?: string; stderr?: string; code?: number; message: string };
      return {
        stdout: err.stdout?.trim() || '',
        stderr: err.stderr?.trim() || err.message,
        exitCode: err.code || 1,
        error: err.message
      };
    }
  },
});

// Deprecated: Kept for backward compatibility if needed, but defaults to process.cwd()
export const ExecuteCommandTool = createExecuteCommandTool(process.cwd());
