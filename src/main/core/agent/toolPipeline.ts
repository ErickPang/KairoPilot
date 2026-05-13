import {
  createRunStep,
  updateRunStep,
  updateToolCallRecord
} from '../../store/chat';
import type { ToolDefinition } from '../llm/types';
import { PermissionGuard, redactSensitiveValue } from '../security/permissions';
import { unwrapToolExecutionResult } from '../tools/result';
import { normalizeExecuteCommandInput } from '../tools/shell';
import { getConfiguredWebSearchProviders } from '../tools/web';
import type { RuntimeUpdate } from './runEngine';

export type PermissionDecision =
  | { kind: 'allow'; args: Record<string, unknown> }
  | { kind: 'approval'; args: Record<string, unknown> }
  | { kind: 'deny'; args: Record<string, unknown>; error: string };

interface AuditLogEntry {
  tool: string;
  args: Record<string, unknown>;
  result?: unknown;
  error?: string;
  policyTags?: string[];
  sessionId?: string;
  runId?: string;
  stepId?: string;
}

interface ToolFailureParams {
  runId: string;
  sessionId?: string;
  permissionGuard: PermissionGuard;
  toolName: string;
  callId: string;
  args: Record<string, unknown>;
  errorMessage: string;
  onUpdate?: (update: RuntimeUpdate) => void;
  toolStepId?: string;
  toolRecordId?: string;
  policyTags: string[];
  auditLog?: (entry: AuditLogEntry) => void;
  emitUpdate: (onUpdate: ((update: RuntimeUpdate) => void) | undefined, update: RuntimeUpdate) => void;
  appendToolMessage: (toolName: string, callId: string, content: string) => void;
}

interface ExecuteApprovedToolParams {
  runId: string;
  sessionId?: string;
  permissionGuard: PermissionGuard;
  tool: ToolDefinition;
  toolName: string;
  args: Record<string, unknown>;
  callId: string;
  onUpdate?: (update: RuntimeUpdate) => void;
  toolStepId?: string;
  toolRecordId?: string;
  policyTags: string[];
  auditLog?: (entry: AuditLogEntry) => void;
  emitUpdate: (onUpdate: ((update: RuntimeUpdate) => void) | undefined, update: RuntimeUpdate) => void;
  appendToolMessage: (toolName: string, callId: string, content: string) => void;
}

export async function executeApprovedTool(params: ExecuteApprovedToolParams) {
  const {
    runId,
    sessionId,
    permissionGuard,
    tool,
    toolName,
    args,
    callId,
    onUpdate,
    toolStepId,
    toolRecordId,
    policyTags,
    auditLog,
    emitUpdate,
    appendToolMessage
  } = params;

  const redactedArgs = permissionGuard.shouldRedactSensitiveOutput()
    ? redactSensitiveValue(args) as Record<string, unknown>
    : args;

  // Track execution timing for observability
  const executionStartTime = Date.now();

  emitUpdate(onUpdate, {
    type: 'tool-call',
    tool: toolName,
    args: redactedArgs,
    runId,
    stepId: toolStepId,
    status: 'running'
  });

  try {
    const rawOutput = await tool.execute(args);
    const executionDurationMs = Date.now() - executionStartTime;
    const executionResult = unwrapToolExecutionResult(rawOutput);
    if (!executionResult.ok) {
      await recordToolFailure({
        runId,
        sessionId,
        permissionGuard,
        toolName,
        callId,
        args,
        errorMessage: executionResult.error,
        onUpdate,
        toolStepId,
        toolRecordId,
        policyTags: [...policyTags, 'decision:error'],
        auditLog,
        emitUpdate,
        appendToolMessage
      });
      return;
    }
    const output = executionResult.data;
    const redactedOutput = permissionGuard.shouldRedactSensitiveOutput()
      ? redactSensitiveValue(output)
      : output;

    // Enhanced step metadata with execution metrics and plugin tracing
    const stepMetadata: Record<string, unknown> = {
      tool: toolName,
      result: output,
      callId,
      executionDurationMs
    };
    if (tool.pluginId) {
      stepMetadata.pluginId = tool.pluginId;
      stepMetadata.pluginVersion = tool.pluginVersion;
    }

    updateRunStep(toolStepId || '', {
      status: 'completed',
      output: stepMetadata
    });
    createRunStep(runId, 'tool_result', `${toolName} 返回结果`, {
      status: 'completed',
      input: {
        tool: toolName,
        callId
      },
      output,
      metadata: {
        executionDurationMs,
        ...(tool.pluginId ? { pluginId: tool.pluginId, pluginVersion: tool.pluginVersion } : {})
      }
    });
    if (toolRecordId) {
      updateToolCallRecord(toolRecordId, {
        result: output,
        status: 'success'
      });
    }
    if (auditLog) {
      auditLog({
        tool: toolName,
        args: redactedArgs,
        result: redactedOutput,
        policyTags: [
          ...policyTags,
          ...(tool.pluginId ? [`plugin:${tool.pluginId}`, `plugin_version:${tool.pluginVersion}`] : []),
          `duration_ms:${executionDurationMs}`
        ],
        sessionId,
        runId,
        stepId: toolStepId
      });
    }
    emitUpdate(onUpdate, {
      type: 'tool-result',
      tool: toolName,
      result: redactedOutput,
      runId,
      stepId: toolStepId,
      status: 'completed'
    });
    appendToolMessage(toolName, callId, JSON.stringify(output));
  } catch (error) {
    const executionDurationMs = Date.now() - executionStartTime;
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    await recordToolFailure({
      runId,
      sessionId,
      permissionGuard,
      toolName,
      callId,
      args,
      errorMessage,
      onUpdate,
      toolStepId,
      toolRecordId,
      policyTags: [
        ...policyTags,
        'decision:error',
        ...(tool.pluginId ? [`plugin:${tool.pluginId}`] : []),
        `duration_ms:${executionDurationMs}`
      ],
      auditLog,
      emitUpdate,
      appendToolMessage
    });
  }
}

export async function recordToolFailure(params: ToolFailureParams) {
  const {
    runId,
    sessionId,
    permissionGuard,
    toolName,
    callId,
    args,
    errorMessage,
    onUpdate,
    toolStepId,
    toolRecordId,
    policyTags,
    auditLog,
    emitUpdate,
    appendToolMessage
  } = params;

  const redactedArgs = permissionGuard.shouldRedactSensitiveOutput()
    ? redactSensitiveValue(args) as Record<string, unknown>
    : args;
  const redactedErrorMessage = permissionGuard.shouldRedactSensitiveOutput()
    ? String(redactSensitiveValue(errorMessage))
    : errorMessage;

  if (toolStepId) {
    updateRunStep(toolStepId, {
      status: 'failed',
      error: errorMessage,
      output: {
        tool: toolName,
        callId
      }
    });
  } else {
    createRunStep(runId, 'tool_call', `调用工具 ${toolName}`, {
      status: 'failed',
      input: {
        tool: toolName,
        args: redactedArgs,
        callId
      },
      error: errorMessage
    });
  }

  createRunStep(runId, 'tool_result', `${toolName} 执行失败`, {
    status: 'failed',
    input: {
      tool: toolName,
      callId
    },
    error: errorMessage
  });

  if (toolRecordId) {
    updateToolCallRecord(toolRecordId, {
      error: errorMessage,
      status: 'failed'
    });
  }

  if (auditLog) {
    auditLog({
      tool: toolName,
      args: redactedArgs,
      error: redactedErrorMessage,
      policyTags,
      sessionId,
      runId,
      stepId: toolStepId
    });
  }

  emitUpdate(onUpdate, {
    type: 'tool-error',
    tool: toolName,
    error: redactedErrorMessage,
    runId,
    stepId: toolStepId,
    status: 'failed'
  });
  appendToolMessage(toolName, callId, `Error executing tool: ${errorMessage}`);
}

/**
 * Set of tool names that are built-in to KairoPilot and have explicit permission checks.
 * Any tool NOT in this set is treated as a dynamic/plugin tool and subject to
 * additional security constraints.
 */
const BUILTIN_TOOL_NAMES = new Set([
  'read_file',
  'write_file',
  'list_directory',
  'delete_file',
  'execute_command',
  'system_info',
  'web_search',
  'fetch_webpage',
  'http_request',
  'load_skill',
  'read_skill_resource',
  'run_skill_script'
]);

export function checkPermission(
  permissionGuard: PermissionGuard,
  toolName: string,
  rawArgs: Record<string, unknown>
): PermissionDecision {
  const args = { ...rawArgs };
  const executionProfile = permissionGuard.getExecutionProfile();
  const isWriteTool = toolName === 'write_file' || toolName === 'delete_file';
  const isCommandTool = toolName === 'execute_command' || toolName === 'run_skill_script';

  if (executionProfile === 'chat_only') {
    return {
      kind: 'deny',
      args,
      error: `Permission Denied: Execution profile '${executionProfile}' does not allow tool execution.`
    };
  }

  if (executionProfile === 'read_only_workspace' && (isWriteTool || isCommandTool)) {
    return {
      kind: 'deny',
      args,
      error: `Permission Denied: Execution profile '${executionProfile}' does not allow ${toolName}.`
    };
  }

  if (toolName === 'read_file' || toolName === 'write_file' || toolName === 'list_directory' || toolName === 'delete_file') {
    const mode = toolName === 'write_file' || toolName === 'delete_file' ? 'write' : 'read';
    const targetPath = (args.path || args.file_path) as string;
    if (!permissionGuard.checkFileSystem(targetPath, mode)) {
      return {
        kind: 'deny',
        args,
        error: `Permission Denied: File System access to ${targetPath} is not allowed.`
      };
    }
  }

  if (toolName === 'execute_command') {
    try {
      const normalizedCommand = normalizeExecuteCommandInput(args);
      args.command = normalizedCommand.command;
      args.args = normalizedCommand.args;
      if (!permissionGuard.checkShellCommand(normalizedCommand.command)) {
        return {
          kind: 'deny',
          args,
          error: `Permission Denied: Command '${normalizedCommand.command}' is not allowed.`
        };
      }
    } catch (error) {
      return {
        kind: 'deny',
        args,
        error: error instanceof Error ? error.message : 'Invalid execute_command arguments.'
      };
    }
  }

  if (toolName === 'run_skill_script') {
    const scriptPath = typeof args.scriptPath === 'string' ? args.scriptPath.trim().toLowerCase() : '';
    const supportedScriptExtensions = ['.js', '.mjs', '.cjs', '.py', '.sh'];
    const isSupportedSkillScript = scriptPath.startsWith('scripts/')
      && supportedScriptExtensions.some((extension) => scriptPath.endsWith(extension));
    if (!isSupportedSkillScript) {
      return {
        kind: 'deny',
        args,
        error: `Permission Denied: Skill scripts must stay under scripts/ and use one of ${supportedScriptExtensions.join(', ')}.`
      };
    }
    let command = typeof args.command === 'string' ? args.command.trim() : '';
    if (!command) {
      if (scriptPath.endsWith('.js') || scriptPath.endsWith('.mjs') || scriptPath.endsWith('.cjs')) {
        command = 'node';
      } else if (scriptPath.endsWith('.py')) {
        command = 'python3';
      } else if (scriptPath.endsWith('.sh')) {
        command = 'bash';
      }
    }
    if (!command) {
      return {
        kind: 'deny',
        args,
        error: 'Permission Denied: Skill script command is required.'
      };
    }
    args.command = command;
    if (!permissionGuard.checkShellCommand(command)) {
      return {
        kind: 'deny',
        args,
        error: `Permission Denied: Command '${command}' is not allowed.`
      };
    }
  }

  if (toolName === 'web_search' || toolName === 'fetch_webpage' || toolName === 'http_request') {
    if (toolName === 'web_search') {
      const searchProviders = getConfiguredWebSearchProviders();
      const allowedSearchProviders = searchProviders
        .filter((provider) => provider.permissionUrls.some((permissionUrl) => permissionGuard.checkNetwork(permissionUrl)))
        .map((provider) => provider.id);

      if (allowedSearchProviders.length === 0) {
        const allowedTargets = permissionGuard.getAllowedNetworkTargets();
        const hasAllowlist = allowedTargets.length > 0;
        const providerTargets = searchProviders
          .map((provider) => `${provider.label}: ${provider.permissionUrls.join(' | ')}`)
          .join(', ');
        const allowlistHint = hasAllowlist
          ? ` Current allowed network targets: ${allowedTargets.join(', ')}.`
          : ' No allowed network targets are configured, so this usually means the execution profile or network toggle is still blocking access.';
        return {
          kind: 'deny',
          args,
          error: `Real-time web access is not available for this request. web_search requires at least one reachable search provider. Supported providers: ${providerTargets}.${allowlistHint}`
        };
      }

      args.__allowedSearchProviders = allowedSearchProviders;
    } else {
      const urlToCheck = args.url as string;
      if (!permissionGuard.checkNetwork(urlToCheck)) {
        const allowedTargets = permissionGuard.getAllowedNetworkTargets();
        const hasAllowlist = allowedTargets.length > 0;
        const allowlistHint = hasAllowlist
          ? ` Current allowed network targets: ${allowedTargets.join(', ')}.`
          : ' No allowed network targets are configured, so this usually means the execution profile or network toggle is still blocking access.';
        const toolLabel = toolName === 'http_request' ? 'http_request' : 'fetch_webpage';
        return {
          kind: 'deny',
          args,
          error: `Real-time web access is not available for this request. ${toolLabel} requires access to the target page URL.${allowlistHint}`
        };
      }
    }
  }

  if (permissionGuard.shouldRequireApproval(toolName, args)) {
    return {
      kind: 'approval',
      args
    };
  }

  // ===== Plugin/Dynamic Tool Permission Enforcement =====
  // Tools not in the built-in set come from plugins. Apply additional
  // security constraints to prevent uncontrolled plugin execution.
  if (!BUILTIN_TOOL_NAMES.has(toolName)) {
    const riskLevel = permissionGuard.getToolRiskLevel(toolName, args);

    // High-risk or critical plugin tools always require approval
    if (riskLevel === 'critical' || riskLevel === 'high') {
      return {
        kind: 'approval',
        args
      };
    }

    // For medium-risk plugin tools: require approval unless execution profile
    // is trusted_automation with approval mode 'never'
    if (riskLevel === 'medium') {
      const approvalMode = permissionGuard.getApprovalMode();
      if (approvalMode !== 'never') {
        return {
          kind: 'approval',
          args
        };
      }
    }

    // Low-risk plugin tools in read_only_workspace can still run
    // (they don't directly write or execute commands)
  }

  return {
    kind: 'allow',
    args
  };
}

export function getPolicyTags(toolName: string, args: Record<string, unknown>, permissionGuard?: PermissionGuard): string[] {
  const tags = [`tool:${toolName}`];
  const riskLevel = permissionGuard?.getToolRiskLevel(toolName, args);

  // Tag plugin/dynamic tools for audit visibility
  if (!BUILTIN_TOOL_NAMES.has(toolName)) {
    tags.push('tool_source:plugin');
    tags.push('tool_category:dynamic');
  } else {
    tags.push('tool_source:builtin');
  }

  if (toolName === 'load_skill' || toolName === 'read_skill_resource' || toolName === 'run_skill_script') {
    tags.push('policy:skill_used');
    tags.push('tool_category:skill');
  }

  if (riskLevel) {
    tags.push(`risk:${riskLevel}`);
  }

  if (permissionGuard) {
    tags.push(`approval_mode:${permissionGuard.getApprovalMode()}`);
    tags.push(`scope:${permissionGuard.getEnvironmentScope()}`);
    tags.push(`data_class:${permissionGuard.getDataClass()}`);
    if (permissionGuard.shouldRedactSensitiveOutput()) {
      tags.push('policy:redaction_enabled');
    }
    if (permissionGuard.shouldRequireApproval(toolName, args)) {
      tags.push('policy:confirmation_required');
    }
  }

  if (toolName === 'execute_command' && typeof args.command === 'string') {
    try {
      const normalizedCommand = normalizeExecuteCommandInput(args);
      tags.push(`command:${normalizedCommand.command}`);
    } catch {
      tags.push(`command:${args.command as string}`);
    }
  }

  return tags;
}
