import { z } from 'zod';
import path from 'path';

// Define the permission schema
export const PermissionSchema = z.object({
  fileSystem: z.object({
    read: z.boolean().default(false),
    write: z.boolean().default(false),
    allowedPaths: z.array(z.string()).default([]), // Absolute paths only
  }),
  network: z.object({
    enabled: z.boolean().default(false),
    allowedDomains: z.array(z.string()).optional(), // Empty means all if enabled
  }),
  shell: z.object({
    enabled: z.boolean().default(false),
    allowedCommands: z.array(z.string()).default([]), // e.g., ['git', 'npm']
  }),
});

export type PermissionConfig = z.infer<typeof PermissionSchema>;

export class PermissionGuard {
  private config: PermissionConfig;

  constructor(config: PermissionConfig) {
    this.config = config;
  }

  /**
   * Check if a file path is allowed for reading or writing.
   * Enforces strict path containment within allowed directories.
   */
  checkFileSystem(targetPath: string, mode: 'read' | 'write'): boolean {
    const isRead = mode === 'read';
    const isWrite = mode === 'write';

    if (isRead && !this.config.fileSystem.read) return false;
    if (isWrite && !this.config.fileSystem.write) return false;

    const absoluteTarget = path.resolve(targetPath);
    
    // Check if target is within any allowed path
    return this.config.fileSystem.allowedPaths.some(allowedPath => {
      const absoluteAllowed = path.resolve(allowedPath);
      // Ensure we don't accidentally allow parent traversal
      const relative = path.relative(absoluteAllowed, absoluteTarget);
      return !relative.startsWith('..') && !path.isAbsolute(relative);
    });
  }

  /**
   * Check if a shell command is allowed.
   * Matches the command binary name.
   */
  checkShellCommand(command: string): boolean {
    if (!this.config.shell.enabled) return false;
    
    // Extract the binary name (first word)
    const binary = command.trim().split(/\s+/)[0];
    return this.config.shell.allowedCommands.includes(binary);
  }

  /**
   * Check if a network domain is allowed.
   */
  checkNetwork(url: string): boolean {
    if (!this.config.network.enabled) return false;
    
    // If allowedDomains is undefined or empty, allow all (if network enabled)
    // But for stricter security, you might want to default to block.
    if (!this.config.network.allowedDomains || this.config.network.allowedDomains.length === 0) {
      return true; 
    }

    try {
      const hostname = new URL(url).hostname;
      return this.config.network.allowedDomains.some(domain => 
        hostname === domain || hostname.endsWith('.' + domain)
      );
    } catch {
      return false; // Invalid URL
    }
  }
}
