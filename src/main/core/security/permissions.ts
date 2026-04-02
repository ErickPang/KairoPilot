import { z } from 'zod';
import path from 'path';
import fs from 'fs';
import os from 'os';
import {
  ApprovalMode,
  createDefaultPolicyConfig,
  DataClass,
  EnvironmentScope,
  ExecutionProfile,
  RiskLevel
} from '../../../shared/contracts';

const DEFAULT_SHELL_TIMEOUT_MS = 60_000;
const DEFAULT_SHELL_MAX_BUFFER_BYTES = 256 * 1024;
const TRUSTED_SHELL_TIMEOUT_MS = 120_000;
const TRUSTED_SHELL_MAX_BUFFER_BYTES = 1024 * 1024;

export interface ShellExecutionPolicy {
  enabled: boolean;
  requiresApproval: boolean;
  timeoutMs: number;
  maxBufferBytes: number;
  allowInteractive: boolean;
}

const PolicySchema = z.object({
  approvalMode: z.enum(['never', 'on_write', 'on_external', 'always']).optional(),
  environmentScope: z.enum(['workspace', 'allowed_paths', 'isolated_env']).optional(),
  dataClass: z.enum(['public', 'project', 'sensitive']).optional(),
  redactSensitiveOutput: z.boolean().optional()
});

type PermissionConfigInput = {
  executionProfile: ExecutionProfile;
  policy?: z.infer<typeof PolicySchema>;
  fileSystem: {
    read: boolean;
    write: boolean;
    allowedPaths: string[];
  };
  network: {
    enabled: boolean;
    allowedDomains?: string[];
  };
  shell: {
    enabled: boolean;
    allowedCommands: string[];
    timeoutMs?: number;
    maxBufferBytes?: number;
    allowInteractive?: boolean;
  };
};

// Define the permission schema
export const PermissionSchema = z.object({
  executionProfile: z.enum(['chat_only', 'read_only_workspace', 'approved_execution', 'trusted_automation']).default('chat_only'),
  policy: PolicySchema.default(createDefaultPolicyConfig('chat_only')),
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
    timeoutMs: z.number().int().positive().optional(),
    maxBufferBytes: z.number().int().positive().optional(),
    allowInteractive: z.boolean().optional()
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

  constructor(config: PermissionConfigInput | PermissionConfig) {
    this.config = PermissionSchema.parse({
      ...config,
      policy: {
        ...createDefaultPolicyConfig(config.executionProfile),
        ...(typeof config.policy === 'object' && config.policy ? config.policy : {})
      }
    });
  }

  getExecutionProfile(): ExecutionProfile {
    return this.config.executionProfile;
  }

  getApprovalMode(): ApprovalMode {
    return this.config.policy.approvalMode ?? createDefaultPolicyConfig(this.config.executionProfile).approvalMode;
  }

  getEnvironmentScope(): EnvironmentScope {
    return this.config.policy.environmentScope ?? createDefaultPolicyConfig(this.config.executionProfile).environmentScope;
  }

  getDataClass(): DataClass {
    return this.config.policy.dataClass ?? createDefaultPolicyConfig(this.config.executionProfile).dataClass;
  }

  shouldRedactSensitiveOutput(): boolean {
    return this.config.policy.redactSensitiveOutput ?? createDefaultPolicyConfig(this.config.executionProfile).redactSensitiveOutput;
  }

  getShellExecutionPolicy(): ShellExecutionPolicy {
    const approvalMode = this.getApprovalMode();
    if (!this.config.shell.enabled) {
      return {
        enabled: false,
        requiresApproval: false,
        timeoutMs: this.config.shell.timeoutMs ?? DEFAULT_SHELL_TIMEOUT_MS,
        maxBufferBytes: this.config.shell.maxBufferBytes ?? DEFAULT_SHELL_MAX_BUFFER_BYTES,
        allowInteractive: this.config.shell.allowInteractive ?? false
      };
    }

    if (this.config.executionProfile === 'trusted_automation') {
      return {
        enabled: true,
        requiresApproval: approvalMode === 'always' || approvalMode === 'on_external',
        timeoutMs: this.config.shell.timeoutMs ?? TRUSTED_SHELL_TIMEOUT_MS,
        maxBufferBytes: this.config.shell.maxBufferBytes ?? TRUSTED_SHELL_MAX_BUFFER_BYTES,
        allowInteractive: this.config.shell.allowInteractive ?? false
      };
    }

    return {
      enabled: this.config.executionProfile === 'approved_execution',
      requiresApproval: approvalMode !== 'never',
      timeoutMs: this.config.shell.timeoutMs ?? DEFAULT_SHELL_TIMEOUT_MS,
      maxBufferBytes: this.config.shell.maxBufferBytes ?? DEFAULT_SHELL_MAX_BUFFER_BYTES,
      allowInteractive: this.config.shell.allowInteractive ?? false
    };
  }

  shouldAllowHighRiskWrites(): boolean {
    return this.config.executionProfile === 'trusted_automation';
  }

  getToolRiskLevel(toolName: string, args: Record<string, unknown> = {}): RiskLevel {
    if (toolName === 'delete_file') {
      return 'critical';
    }

    if (toolName === 'execute_command') {
      const command = typeof args.command === 'string' ? args.command.toLowerCase() : '';
      if (/(^|\/)(rm|sudo|chmod|chown|mv|dd|launchctl|osascript)$/.test(command)) {
        return 'critical';
      }
      return 'high';
    }

    if (toolName === 'run_skill_script') {
      return 'high';
    }

    if (toolName === 'write_file') {
      const targetPath = String(args.path || args.file_path || '').toLowerCase();
      if (targetPath.includes('.env') || targetPath.includes('/.ssh/') || targetPath.endsWith('/.ssh')) {
        return 'critical';
      }
      return 'high';
    }

    if (toolName === 'web_search' || toolName === 'fetch_webpage') {
      return 'medium';
    }

    if (toolName === 'read_file' || toolName === 'list_directory' || toolName === 'system_info') {
      return this.getDataClass() === 'sensitive' ? 'medium' : 'low';
    }

    return 'medium';
  }

  shouldRequireApproval(toolName: string, args: Record<string, unknown> = {}): boolean {
    const approvalMode = this.getApprovalMode();
    if (approvalMode === 'never') {
      return false;
    }

    if (approvalMode === 'always') {
      return true;
    }

    const isWriteTool = toolName === 'write_file' || toolName === 'delete_file';
    const isExternalTool = toolName === 'web_search'
      || toolName === 'fetch_webpage'
      || toolName === 'execute_command'
      || toolName === 'run_skill_script';

    if (approvalMode === 'on_write') {
      return isWriteTool || this.getToolRiskLevel(toolName, args) === 'critical';
    }

    if (approvalMode === 'on_external') {
      return isExternalTool || this.getToolRiskLevel(toolName, args) === 'critical';
    }

    return false;
  }

  /**
   * Check if a path is safe and strictly contained within the base path.
   * This prevents directory traversal attacks (e.g. ../../etc/passwd)
   */
  private isPathSafe(basePath: string, targetPath: string): boolean {
    const resolvedBase = this.resolvePathForContainment(basePath);
    const resolvedTarget = this.resolvePathForContainment(targetPath);
    // It must start with the base path + separator (to avoid matching /project-evil with /project),
    // or it must be exactly the base path.
    return resolvedTarget.startsWith(resolvedBase + path.sep) || resolvedTarget === resolvedBase;
  }

  private resolvePathForContainment(targetPath: string): string {
    const absolutePath = path.resolve(targetPath);
    const missingSegments: string[] = [];
    let currentPath = absolutePath;

    while (!fs.existsSync(currentPath)) {
      const parentPath = path.dirname(currentPath);
      if (parentPath === currentPath) {
        break;
      }
      missingSegments.unshift(path.basename(currentPath));
      currentPath = parentPath;
    }

    try {
      if (fs.existsSync(currentPath)) {
        const resolvedExistingPath = fs.realpathSync(currentPath);
        return missingSegments.length > 0
          ? path.join(resolvedExistingPath, ...missingSegments)
          : resolvedExistingPath;
      }
    } catch {
      // Ignore and fall back to resolved absolute path below.
    }

    return absolutePath;
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

    const absoluteTarget = this.resolvePathForContainment(targetPath);

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
    const shellPolicy = this.getShellExecutionPolicy();
    if (!shellPolicy.enabled) return false;

    return this.config.shell.allowedCommands.includes(command.trim());
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

export function redactSensitiveText(value: string): string {
  const normalizedHomePath = os.homedir().trim();
  let result = value;

  if (normalizedHomePath) {
    result = result.split(normalizedHomePath).join('~');
  }

  result = result
    .replace(/-----BEGIN [A-Z ]+-----[\s\S]*?-----END [A-Z ]+-----/g, '[REDACTED_PRIVATE_KEY]')
    .replace(/\b(?:sk|rk)-[A-Za-z0-9_-]{8,}\b/g, '[REDACTED_API_KEY]')
    .replace(/\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g, '[REDACTED_ACCESS_KEY]')
    .replace(/((?:bearer)\s+)([A-Za-z0-9._-]+)/gi, '$1[REDACTED]')
    .replace(/((?:token|api[_-]?key|secret|password|passwd|authorization|cookie)\s*[:=]\s*)([^\s,;]+)/gi, '$1[REDACTED]')
    .replace(/(\b[A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|API_KEY|ACCESS_KEY)\b\s*=\s*)([^\s]+)/gi, '$1[REDACTED]');

  return result;
}

export function redactSensitiveValue(value: unknown): unknown {
  if (typeof value === 'string') {
    return redactSensitiveText(value);
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactSensitiveValue(item));
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entryValue]) => {
        if (/(token|secret|password|passwd|api[_-]?key|authorization|cookie)/i.test(key)) {
          return [key, '[REDACTED]'];
        }
        return [key, redactSensitiveValue(entryValue)];
      })
    );
  }

  return value;
}
