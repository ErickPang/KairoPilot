import { z } from 'zod';
import path from 'path';
import fs from 'fs';

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

// Hardcoded blacklist of sensitive directories that AI should never access
const SENSITIVE_DIRS_BLACKLIST = new Set([
  '.ssh',
  '.gnupg',
  '.aws',
  '.kube',
  'System32',
  'AppData',
  'Library/Application Support', // macOS app data
  'node_modules', // Often too large, can cause issues, though arguably not a security risk like .ssh
  '.git'
]);

const PROTECTED_PROMPT_FILES = new Set([
  'KAIROPILOT.md',
  'IDENTITY.md',
  'USER.md',
  'SOUL.md',
  'MEMORY.md'
]);

export class PermissionGuard {
  private config: PermissionConfig;

  constructor(config: PermissionConfig) {
    this.config = config;
  }

  /**
   * Check if a path is safe and strictly contained within the base path.
   * This prevents directory traversal attacks (e.g. ../../etc/passwd)
   */
  private isPathSafe(basePath: string, targetPath: string): boolean {
    const resolvedBase = path.resolve(basePath);
    const resolvedTarget = path.resolve(targetPath);
    // It must start with the base path + separator (to avoid matching /project-evil with /project),
    // or it must be exactly the base path.
    return resolvedTarget.startsWith(resolvedBase + path.sep) || resolvedTarget === resolvedBase;
  }

  /**
   * Check if a file path is allowed for reading or writing.
   * Enforces strict path containment within allowed directories and blocks sensitive paths.
   */
  checkFileSystem(targetPath: string, mode: 'read' | 'write'): boolean {
    const isRead = mode === 'read';
    const isWrite = mode === 'write';

    if (isRead && !this.config.fileSystem.read) return false;
    if (isWrite && !this.config.fileSystem.write) return false;

    let absoluteTarget = path.resolve(targetPath);

    // Resolve realpath to prevent symlink escape attacks (if the file/dir exists)
    try {
      if (fs.existsSync(absoluteTarget)) {
        absoluteTarget = fs.realpathSync(absoluteTarget);
      }
    } catch {
      // Ignore if we can't resolve realpath (e.g. permission issues during resolution)
    }

    const targetBaseName = path.basename(absoluteTarget);
    if (PROTECTED_PROMPT_FILES.has(targetBaseName)) {
      console.warn(`[Security] Blocked access to protected prompt file: ${absoluteTarget}`);
      return false;
    }

    // 1. Check against hardcoded sensitive directories
    const pathSegments = absoluteTarget.split(path.sep);
    for (const segment of pathSegments) {
      if (SENSITIVE_DIRS_BLACKLIST.has(segment)) {
        console.warn(`[Security] Blocked access to sensitive directory: ${segment} in path ${absoluteTarget}`);
        return false;
      }
    }

    // 2. Prevent accessing root directories directly (e.g. /, C:\)
    if (absoluteTarget === path.parse(absoluteTarget).root) {
      console.warn(`[Security] Blocked access to filesystem root: ${absoluteTarget}`);
      return false;
    }

    // 3. Check if target is safely contained within any allowed workspace path
    return this.config.fileSystem.allowedPaths.some(allowedPath => {
      return this.isPathSafe(allowedPath, absoluteTarget);
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
