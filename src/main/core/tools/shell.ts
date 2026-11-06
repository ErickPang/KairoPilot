import { spawn } from 'child_process';
import { z } from 'zod';
import { ToolDefinition } from '../llm/types';
import { ShellExecutionPolicy } from '../security/permissions';
import { toolError, toolOk } from './result';
const EXECUTION_MAX_BUFFER_BYTES = 1024 * 1024;
const SHELL_CONTROL_PATTERN = /[|&;<>()$`\n\r]/;
const INTERACTIVE_COMMANDS = new Set(['vim', 'vi', 'nano', 'top', 'less', 'more', 'man']);
const INTERACTIVE_ARGS = new Set(['-i', '--interactive', '--watch']);

export interface NormalizedExecuteCommandInput {
  command: string;
  args: string[];
}

export interface ExecuteCommandToolOptions {
  cwd: string;
  policy?: Partial<ShellExecutionPolicy>;
}

function tokenizeCommandLine(commandLine: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let activeQuote: '"' | "'" | null = null;

  for (let index = 0; index < commandLine.length; index += 1) {
    const char = commandLine[index];

    if (activeQuote) {
      if (char === activeQuote) {
        activeQuote = null;
        continue;
      }
      current += char;
      continue;
    }

    if (char === '"' || char === "'") {
      activeQuote = char;
      continue;
    }

    if (/\s/.test(char)) {
      if (current.length > 0) {
        tokens.push(current);
        current = '';
      }
      continue;
    }

    current += char;
  }

  if (activeQuote) {
    throw new Error('Unclosed quote in command input.');
  }

  if (current.length > 0) {
    tokens.push(current);
  }

  return tokens;
}

function validateCommandBinary(command: string): string {
  const normalizedCommand = command.trim();
  if (!normalizedCommand) {
    throw new Error('Command is required.');
  }
  if (SHELL_CONTROL_PATTERN.test(normalizedCommand)) {
    throw new Error('Shell control characters are not allowed in command.');
  }
  if (/\s/.test(normalizedCommand)) {
    throw new Error('Command must be a binary name only. Put arguments in args[].');
  }
  return normalizedCommand;
}

function normalizeCommandArgs(rawArgs: unknown): string[] {
  if (rawArgs === undefined) {
    return [];
  }
  if (!Array.isArray(rawArgs)) {
    throw new Error('args must be an array of strings.');
  }
  return rawArgs.map((value) => {
    if (typeof value !== 'string') {
      throw new Error('args must contain only strings.');
    }
    if (value.includes('\u0000')) {
      throw new Error('args must not contain null bytes.');
    }
    return value;
  });
}

export function normalizeExecuteCommandInput(args: Record<string, unknown>): NormalizedExecuteCommandInput {
  const rawCommand = typeof args.command === 'string' ? args.command.trim() : '';
  const normalizedArgs = normalizeCommandArgs(args.args);

  if (normalizedArgs.length > 0) {
    return {
      command: validateCommandBinary(rawCommand),
      args: normalizedArgs
    };
  }

  if (!rawCommand) {
    throw new Error('Command is required.');
  }

  if (SHELL_CONTROL_PATTERN.test(rawCommand)) {
    throw new Error('Shell control characters are not allowed. Use structured args instead.');
  }

  const tokens = tokenizeCommandLine(rawCommand);
  if (tokens.length === 0) {
    throw new Error('Command is required.');
  }

  return {
    command: validateCommandBinary(tokens[0]),
    args: tokens.slice(1)
  };
}

export function isInteractiveShellCommand(command: string, args: string[]) {
  if (INTERACTIVE_COMMANDS.has(command.trim())) {
    return true;
  }

  return args.some((arg) => INTERACTIVE_ARGS.has(arg.trim()));
}

function getShellPolicy(options: ExecuteCommandToolOptions) {
  return {
    enabled: options.policy?.enabled ?? true,
    requiresApproval: options.policy?.requiresApproval ?? true,
    timeoutMs: options.policy?.timeoutMs ?? 60_000,
    maxBufferBytes: options.policy?.maxBufferBytes ?? EXECUTION_MAX_BUFFER_BYTES,
    allowInteractive: options.policy?.allowInteractive ?? false
  } satisfies ShellExecutionPolicy;
}

export const createExecuteCommandTool = (options: string | ExecuteCommandToolOptions): ToolDefinition => ({
  name: 'execute_command',
  metadata: { source: 'builtin' },
  description: `Execute a non-interactive command in the current workspace (${typeof options === 'string' ? options : options.cwd}). Provide the binary in command and each argument separately in args. Do not use shell operators like &&, |, >, <, ; or command substitution.`,
  parameters: z.object({
    command: z.string().describe('The executable or binary name only, for example "npm", "git", "node", or "python3".'),
    args: z.array(z.string()).default([]).describe('Arguments passed to the executable as a string array, for example ["run", "build"].'),
    verification: z.boolean().optional().describe('Set true only when this command intentionally verifies a task requirement. Records the actual exit status as separate verification evidence.')
  }),
  execute: async (args: Record<string, unknown>, signal?: AbortSignal) => {
    try {
      const resolvedOptions = typeof options === 'string' ? { cwd: options } : options;
      const shellPolicy = getShellPolicy(resolvedOptions);
      const normalized = normalizeExecuteCommandInput(args);
      if (!shellPolicy.enabled) {
        throw new Error('Shell execution is disabled by the current execution profile.');
      }
      if (!shellPolicy.allowInteractive && isInteractiveShellCommand(normalized.command, normalized.args)) {
        throw new Error('Interactive shell commands are not allowed.');
      }

      let stdout = '';
      let stderr = '';
      let totalBuffer = 0;

      const child = spawn(normalized.command, normalized.args, {
        cwd: resolvedOptions.cwd,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      const output = await new Promise<{ stdout: string; stderr: string; exitCode: number }>((resolve, reject) => {
        const onAbort = () => {
          child.kill('SIGTERM');
          // Force kill after 3s if still alive
          setTimeout(() => {
            if (child.exitCode === null) {
              child.kill('SIGKILL');
            }
          }, 3000);
        };

        if (signal) {
          if (signal.aborted) {
            onAbort();
            return;
          }
          signal.addEventListener('abort', onAbort, { once: true });
        }

        // Timeout
        const timeoutId = setTimeout(() => {
          child.kill('SIGTERM');
        }, shellPolicy.timeoutMs);

        child.stdout?.on('data', (chunk: Buffer) => {
          totalBuffer += chunk.length;
          if (totalBuffer > shellPolicy.maxBufferBytes) {
            child.kill('SIGTERM');
            reject(new Error(`Command output exceeded max buffer size of ${shellPolicy.maxBufferBytes} bytes.`));
            return;
          }
          stdout += chunk.toString();
        });

        child.stderr?.on('data', (chunk: Buffer) => {
          totalBuffer += chunk.length;
          if (totalBuffer > shellPolicy.maxBufferBytes) {
            child.kill('SIGTERM');
            reject(new Error(`Command output exceeded max buffer size of ${shellPolicy.maxBufferBytes} bytes.`));
            return;
          }
          stderr += chunk.toString();
        });

        child.on('error', (err) => {
          clearTimeout(timeoutId);
          if (signal) signal.removeEventListener('abort', onAbort);
          reject(err);
        });

        child.on('close', (exitCode) => {
          clearTimeout(timeoutId);
          if (signal) signal.removeEventListener('abort', onAbort);
          resolve({
            stdout: stdout.trim(),
            stderr: stderr.trim(),
            exitCode: exitCode ?? 1,
          });
        });
      });

      if (signal?.aborted) {
        return toolError('Command cancelled by user.', {
          stdout: output.stdout,
          stderr: output.stderr,
          exitCode: output.exitCode,
        });
      }

      if (output.exitCode !== 0) {
        return toolError(`Command exited with code ${output.exitCode}`, {
          stdout: output.stdout,
          stderr: output.stderr || `Exit code: ${output.exitCode}`,
          exitCode: output.exitCode,
        });
      }

      return toolOk({
        stdout: output.stdout,
        stderr: output.stderr,
        exitCode: 0,
      });
    } catch (error) {
      const err = error as { message: string };
      if (signal?.aborted) {
        return toolError('Command cancelled by user.');
      }
      return toolError(err.message || 'Unknown shell error', {
        stdout: '',
        stderr: err.message,
        exitCode: 1,
      });
    }
  },
});
