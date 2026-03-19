import fs from 'fs-extra';
import { z } from 'zod';
import { ToolDefinition } from '../llm/types';

export const ReadFileTool: ToolDefinition = {
  name: 'read_file',
  description: 'Read the content of a file at the specified path.',
  parameters: z.object({
    path: z.string().describe('The absolute path to the file to read.'),
  }),
  execute: async ({ path }: { path: string }) => {
    try {
      const content = await fs.readFile(path, 'utf-8');
      return { content };
    } catch (error: any) {
      throw new Error(`Failed to read file: ${error.message}`);
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
  execute: async ({ path, content }: { path: string; content: string }) => {
    try {
      await fs.outputFile(path, content, 'utf-8');
      return { success: true };
    } catch (error: any) {
      throw new Error(`Failed to write file: ${error.message}`);
    }
  },
};

export const ListDirectoryTool: ToolDefinition = {
  name: 'list_directory',
  description: 'List files and directories in the specified path.',
  parameters: z.object({
    path: z.string().describe('The absolute path to the directory.'),
  }),
  execute: async ({ path }: { path: string }) => {
    try {
      const files = await fs.readdir(path);
      return { files };
    } catch (error: any) {
      throw new Error(`Failed to list directory: ${error.message}`);
    }
  },
};

export const DeleteFileTool: ToolDefinition = {
  name: 'delete_file',
  description: 'Delete a file or directory at the specified path.',
  parameters: z.object({
    path: z.string().describe('The absolute path to the file or directory to delete.'),
  }),
  execute: async ({ path }: { path: string }) => {
    try {
      await fs.remove(path); // fs-extra remove handles both files and directories
      return { success: true };
    } catch (error: any) {
      throw new Error(`Failed to delete path: ${error.message}`);
    }
  },
};
