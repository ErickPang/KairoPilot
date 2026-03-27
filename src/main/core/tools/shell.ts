import { execFile } from 'child_process';
import { promisify } from 'util';
import { z } from 'zod';
import { ToolDefinition } from '../llm/types';

const execFileAsync = promisify(execFile);
const EXECUTION_MAX_BUFFER_BYTES = 1024 * 1024;
const SHELL_CONTROL_PATTERN = /[|&;<>()$`\n\r]/;

export interface NormalizedExecuteCommandInput {
  command: string;
  args: string[];
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

export const createExecuteCommandTool = (cwd: string): ToolDefinition => ({
  name: 'execute_command',
  description: `Execute a non-interactive command in the current workspace (${cwd}). Provide the binary in command and each argument separately in args. Do not use shell operators like &&, |, >, <, ; or command substitution.`,
  parameters: z.object({
    command: z.string().describe('The executable or binary name only, for example "npm", "git", "node", or "python3".'),
    args: z.array(z.string()).default([]).describe('Arguments passed to the executable as a string array, for example ["run", "build"].')
  }),
  execute: async (args: Record<string, unknown>) => {
    try {
      const normalized = normalizeExecuteCommandInput(args);
      console.log(`Executing command: ${normalized.command} ${normalized.args.join(' ')} in ${cwd}`);
      const { stdout, stderr } = await execFileAsync(normalized.command, normalized.args, {
        cwd,
        maxBuffer: EXECUTION_MAX_BUFFER_BYTES,
        windowsHide: true
      });
      return {
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        exitCode: 0
      };
    } catch (error) {
      const err = error as { stdout?: string | Buffer; stderr?: string | Buffer; code?: number; message: string };
      return {
        stdout: String(err.stdout || '').trim(),
        stderr: String(err.stderr || '').trim() || err.message,
        exitCode: err.code || 1,
        error: err.message
      };
    }
  },
});

// Deprecated: Kept for backward compatibility if needed, but defaults to process.cwd()
export const ExecuteCommandTool = createExecuteCommandTool(process.cwd());
