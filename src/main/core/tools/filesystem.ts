import fs from 'fs-extra';
import { z } from 'zod';
import { ToolDefinition } from '../llm/types';

const PROTECTED_PROMPT_FILES = new Set([
  'KAIROPILOT.md',
  'IDENTITY.md',
  'USER.md',
  'SOUL.md',
  'MEMORY.md'
]);

export const ReadFileTool: ToolDefinition = {
  name: 'read_file',
  description: 'Read the content of a file at the specified path.',
  parameters: z.object({
    path: z.string().describe('The absolute path to the file to read.'),
  }),
  execute: async (args: Record<string, unknown>) => {
    try {
      const path = args.path as string;
      const content = await fs.readFile(path, 'utf-8');
      return { content };
    } catch (error) {
      throw new Error(`Failed to read file: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  },
};

export const WriteFileTool: ToolDefinition = {
  name: 'write_file',
  description: 'Write content to a file at the specified path. Overwrites if exists.',
  parameters: z.object({
    path: z.string().describe('The absolute path to the file to write.'),
    content: z.string().describe('The content to write.'),
  }),
  execute: async (args: Record<string, unknown>) => {
    try {
      const path = args.path as string;
      const content = args.content as string;
      await fs.outputFile(path, content, 'utf-8');
      return { success: true };
    } catch (error) {
      throw new Error(`Failed to write file: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  },
};

export const ListDirectoryTool: ToolDefinition = {
  name: 'list_directory',
  description: 'List files and directories in the specified path.',
  parameters: z.object({
    path: z.string().describe('The absolute path to the directory.'),
  }),
  execute: async (args: Record<string, unknown>) => {
    try {
      const path = args.path as string;
      const files = await fs.readdir(path);
      return {
        files: files.filter(name => !PROTECTED_PROMPT_FILES.has(name))
      };
    } catch (error) {
      return `Failed to list directory: ${error instanceof Error ? error.message : 'Unknown error'}`;
    }
  },
};

export const DeleteFileTool: ToolDefinition = {
  name: 'delete_file',
  description: 'Delete a file or directory at the specified path.',
  parameters: z.object({
    path: z.string().describe('The absolute path to the file or directory to delete.'),
  }),
  execute: async (args: Record<string, unknown>) => {
    try {
      const path = args.path as string;
      await fs.remove(path); // fs-extra remove handles both files and directories
      return { success: true };
    } catch (error) {
      throw new Error(`Failed to delete path: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  },
};
