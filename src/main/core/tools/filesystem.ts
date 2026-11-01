import fs from 'fs-extra';
import { z } from 'zod';
import { ToolDefinition } from '../llm/types';
import { PROTECTED_PROMPT_FILES } from '../security/policyConstants';
import { toolError, toolOk } from './result';

export const ReadFileTool: ToolDefinition = {
  name: 'read_file',
  description: 'Read the content of a file at the specified path.',
  parameters: z.object({
    path: z.string().describe('The absolute path to the file to read.'),
  }),
  execute: async (args: Record<string, unknown>) => {
    try {
      const targetPath = args.path as string;
      const content = await fs.readFile(targetPath, 'utf-8');
      return toolOk({ content });
    } catch (error) {
      return toolError(`Failed to read file: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  },
};

export const WriteFileTool: ToolDefinition = {
  name: 'write_file',
  metadata: { source: 'builtin' },
  description: 'Write content to a file at the specified path. Overwrites if exists.',
  parameters: z.object({
    path: z.string().describe('The absolute path to the file to write.'),
    content: z.string().describe('The content to write.'),
  }),
  execute: async (args: Record<string, unknown>) => {
    try {
      const targetPath = args.path as string;
      const content = args.content as string;
      await fs.outputFile(targetPath, content, 'utf-8');
      return toolOk({ success: true });
    } catch (error) {
      return toolError(`Failed to write file: ${error instanceof Error ? error.message : 'Unknown error'}`);
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
      const targetPath = args.path as string;
      const files = await fs.readdir(targetPath);
      return toolOk({
        files: files.filter(name => !PROTECTED_PROMPT_FILES.has(name))
      });
    } catch (error) {
      return toolError(`Failed to list directory: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  },
};

export const DeleteFileTool: ToolDefinition = {
  name: 'delete_file',
  metadata: { source: 'builtin' },
  description: 'Delete a file or directory at the specified path.',
  parameters: z.object({
    path: z.string().describe('The absolute path to the file or directory to delete.'),
  }),
  execute: async (args: Record<string, unknown>) => {
    try {
      const targetPath = args.path as string;
      await fs.remove(targetPath);
      return toolOk({ success: true });
    } catch (error) {
      return toolError(`Failed to delete path: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  },
};
