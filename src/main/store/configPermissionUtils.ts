import {
  applyExecutionProfileConstraints,
  createDefaultAgentPermissions,
  createDefaultPolicyConfig,
  type AgentConfig,
  type AgentPermissionConfig,
  type ExecutionProfile
} from '../../shared/contracts';

function normalizePermissionList(values: unknown): string[] {
  if (!Array.isArray(values)) {
    return [];
  }

  return [...new Set(values
    .filter((item): item is string => typeof item === 'string')
    .map(item => item.trim())
    .filter(Boolean))];
}

function normalizePermissionFlag(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function normalizeExecutionProfile(value: unknown): ExecutionProfile | undefined {
  return value === 'chat_only'
    || value === 'read_only_workspace'
    || value === 'approved_execution'
    || value === 'trusted_automation'
    ? value
    : undefined;
}

function normalizeApprovalMode(value: unknown): AgentPermissionConfig['policy']['approvalMode'] | undefined {
  return value === 'never'
    || value === 'on_write'
    || value === 'on_external'
    || value === 'always'
    ? value
    : undefined;
}

function normalizeEnvironmentScope(value: unknown): AgentPermissionConfig['policy']['environmentScope'] | undefined {
  return value === 'workspace'
    || value === 'allowed_paths'
    || value === 'isolated_env'
    ? value
    : undefined;
}

function normalizeDataClass(value: unknown): AgentPermissionConfig['policy']['dataClass'] | undefined {
  return value === 'public'
    || value === 'project'
    || value === 'sensitive'
    ? value
    : undefined;
}

function inferExecutionProfile(seed: Partial<AgentConfig> & {
  permissions?: Partial<AgentPermissionConfig>;
  enableShell?: boolean;
  enableNetwork?: boolean;
  enableFileSystemRead?: boolean;
  enableFileSystemWrite?: boolean;
}) {
  const explicitProfile = normalizeExecutionProfile(seed?.permissions?.executionProfile);
  if (explicitProfile) {
    return explicitProfile;
  }

  const shellEnabled = normalizePermissionFlag(seed?.permissions?.shell?.enabled)
    ?? normalizePermissionFlag(seed?.enableShell)
    ?? false;
  const writeEnabled = normalizePermissionFlag(seed?.permissions?.fileSystem?.write)
    ?? normalizePermissionFlag(seed?.enableFileSystemWrite)
    ?? false;
  const readEnabled = normalizePermissionFlag(seed?.permissions?.fileSystem?.read)
    ?? normalizePermissionFlag(seed?.enableFileSystemRead)
    ?? false;
  const networkEnabled = normalizePermissionFlag(seed?.permissions?.network?.enabled)
    ?? normalizePermissionFlag(seed?.enableNetwork)
    ?? false;

  if (shellEnabled || writeEnabled) {
    return 'approved_execution';
  }

  if (readEnabled || networkEnabled) {
    return 'read_only_workspace';
  }

  return createDefaultAgentPermissions().executionProfile;
}

export function normalizeAgentPermissions(seed?: Partial<AgentConfig> & {
  permissions?: Partial<AgentPermissionConfig>;
  allowedPaths?: string[];
  allowedCommands?: string[];
  allowedDomains?: string[];
  enableShell?: boolean;
  enableNetwork?: boolean;
  enableFileSystemRead?: boolean;
  enableFileSystemWrite?: boolean;
}): AgentPermissionConfig {
  const defaults = createDefaultAgentPermissions();
  const executionProfile = inferExecutionProfile(seed ?? {});
  const policyDefaults = createDefaultPolicyConfig(executionProfile);
  const normalizedPermissions = applyExecutionProfileConstraints({
    executionProfile,
    policy: {
      approvalMode: normalizeApprovalMode(seed?.permissions?.policy?.approvalMode)
        ?? policyDefaults.approvalMode,
      environmentScope: normalizeEnvironmentScope(seed?.permissions?.policy?.environmentScope)
        ?? policyDefaults.environmentScope,
      dataClass: normalizeDataClass(seed?.permissions?.policy?.dataClass)
        ?? policyDefaults.dataClass,
      redactSensitiveOutput: normalizePermissionFlag(seed?.permissions?.policy?.redactSensitiveOutput)
        ?? policyDefaults.redactSensitiveOutput
    },
    fileSystem: {
      read: normalizePermissionFlag(seed?.permissions?.fileSystem?.read)
        ?? normalizePermissionFlag(seed?.enableFileSystemRead)
        ?? defaults.fileSystem.read,
      write: normalizePermissionFlag(seed?.permissions?.fileSystem?.write)
        ?? normalizePermissionFlag(seed?.enableFileSystemWrite)
        ?? defaults.fileSystem.write,
      allowedPaths: normalizePermissionList(seed?.permissions?.fileSystem?.allowedPaths ?? seed?.allowedPaths)
    },
    network: {
      enabled: normalizePermissionFlag(seed?.permissions?.network?.enabled)
        ?? normalizePermissionFlag(seed?.enableNetwork)
        ?? defaults.network.enabled,
      allowedDomains: normalizePermissionList(seed?.permissions?.network?.allowedDomains ?? seed?.allowedDomains)
    },
    shell: {
      enabled: normalizePermissionFlag(seed?.permissions?.shell?.enabled)
        ?? normalizePermissionFlag(seed?.enableShell)
        ?? defaults.shell.enabled,
      allowedCommands: normalizePermissionList(seed?.permissions?.shell?.allowedCommands ?? seed?.allowedCommands)
    }
  });

  return {
    ...normalizedPermissions,
    shell: {
      ...normalizedPermissions.shell,
      allowedCommands: normalizedPermissions.shell.enabled ? normalizedPermissions.shell.allowedCommands : []
    }
  };
}
