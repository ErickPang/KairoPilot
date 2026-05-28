import {
  createRunStep,
  updateRunStep,
  updateToolCallRecord
} from '../../store/chat';
import type { ToolDefinition } from '../llm/types';
import { PermissionGuard, redactSensitiveValue } from '../security/permissions';
import { toolError, unwrapToolExecutionResult } from '../tools/result';
import { normalizeExecuteCommandInput } from '../tools/shell';
import { getConfiguredWebSearchProviders } from '../tools/web';
import type { RuntimeUpdate } from './runEngine';

export interface PermissionGuardedToolDefinition extends ToolDefinition {
  executeApproved: (args: Record<string, unknown>) => Promise<unknown>;
}

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
  shouldInterrupt?: () => { kind: 'pause' | 'cancel'; reason?: string } | null;
  emitUpdate: (onUpdate: ((update: RuntimeUpdate) => void) | undefined, update: RuntimeUpdate) => void;
  appendToolMessage: (toolName: string, callId: string, content: string) => void;
}

function isPermissionGuardedTool(tool: ToolDefinition): tool is PermissionGuardedToolDefinition {
  return typeof (tool as Partial<PermissionGuardedToolDefinition>).executeApproved === 'function';
}

export function createPermissionGuardedTool(
  tool: ToolDefinition,
  permissionGuard: PermissionGuard
): PermissionGuardedToolDefinition {
  if (isPermissionGuardedTool(tool)) {
    return tool;
  }

  return {
    ...tool,
    async execute(args: Record<string, unknown>) {
      const decision = checkPermission(permissionGuard, tool.name, args);
      if (decision.kind === 'deny') {
        return toolError(decision.error);
      }
      if (decision.kind === 'approval') {
        return toolError(`Permission Denied: Tool '${tool.name}' requires approval through the runtime approval flow.`);
      }
      return tool.execute(decision.args);
    },
    async executeApproved(args: Record<string, unknown>) {
      const decision = checkPermission(permissionGuard, tool.name, args);
      if (decision.kind === 'deny') {
        return toolError(decision.error);
      }
      return tool.execute(decision.args);
    }
  };
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
    shouldInterrupt,
    emitUpdate,
    appendToolMessage
  } = params;

  const redactedArgs = permissionGuard.shouldRedactSensitiveOutput()
    ? redactSensitiveValue(args) as Record<string, unknown>
    : args;

  emitUpdate(onUpdate, {
    type: 'tool-call',
    tool: toolName,
    args: redactedArgs,
    runId,
    stepId: toolStepId,
    status: 'running'
  });

  try {
    const rawOutput = isPermissionGuardedTool(tool)
      ? await tool.executeApproved(args)
      : await tool.execute(args);
    const postToolInterrupt = shouldInterrupt?.();
    if (postToolInterrupt) {
      const cancelled = postToolInterrupt.kind === 'cancel';
      const reason = postToolInterrupt.reason || (cancelled ? 'Run cancelled by user.' : 'Run paused by user.');
      updateRunStep(toolStepId || '', {
        status: cancelled ? 'cancelled' : 'completed',
        output: {
          tool: toolName,
          callId,
          interrupted: true,
          reason,
          discardedToolOutput: true
        }
      });
      if (toolRecordId) {
        updateToolCallRecord(toolRecordId, {
          status: cancelled ? 'cancelled' : 'running'
        });
      }
      emitUpdate(onUpdate, {
        type: cancelled ? 'run-cancelled' : 'run-paused',
        runId,
        stepId: toolStepId,
        status: cancelled ? 'cancelled' : 'paused',
        error: cancelled ? reason : undefined
      });
      return;
    }

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
    updateRunStep(toolStepId || '', {
      status: 'completed',
      output: {
        tool: toolName,
        result: output,
        callId
      }
    });
    createRunStep(runId, 'tool_result', `${toolName} 返回结果`, {
      status: 'completed',
      input: {
        tool: toolName,
        callId
      },
      output
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
        policyTags,
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
      policyTags: [...policyTags, 'decision:error'],
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

export function checkPermission(
  permissionGuard: PermissionGuard,
  toolName: string,
  rawArgs: Record<string, unknown>
): PermissionDecision {
  const args = { ...rawArgs };
  const executionProfile = permissionGuard.getExecutionProfile();
  const isWriteTool = toolName === 'write_file' || toolName === 'delete_file';
  const isCommandTool = toolName === 'execute_command' || toolName === 'run_skill_script';

  if (executionProfile === 'chat_only' && toolName !== 'read_attachment') {
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

  if (toolName === 'read_attachment') {
    return {
      kind: 'allow',
      args
    };
  }

  if (permissionGuard.shouldRequireApproval(toolName, args)) {
    return {
      kind: 'approval',
      args
    };
  }

  return {
    kind: 'allow',
    args
  };
}

export function getPolicyTags(toolName: string, args: Record<string, unknown>, permissionGuard?: PermissionGuard): string[] {
  const tags = [`tool:${toolName}`];
  const riskLevel = permissionGuard?.getToolRiskLevel(toolName, args);
  if (toolName === 'load_skill' || toolName === 'read_skill_resource' || toolName === 'run_skill_script') {
    tags.push('policy:skill_used');
    tags.push('tool_category:skill');
    const skillName = typeof args.skill === 'string'
      ? args.skill
      : typeof args.name === 'string'
        ? args.name
        : '';
    const normalizedSkillName = normalizePolicyTagValue(skillName);
    if (normalizedSkillName) {
      tags.push(`skill:${normalizedSkillName}`);
    }
    if (toolName === 'read_skill_resource' && typeof args.path === 'string') {
      const resourcePath = normalizePolicyTagValue(args.path);
      if (resourcePath) {
        tags.push(`skill_resource:${resourcePath}`);
      }
    }
    if (toolName === 'run_skill_script' && typeof args.scriptPath === 'string') {
      const scriptPath = normalizePolicyTagValue(args.scriptPath);
      if (scriptPath) {
        tags.push(`skill_script:${scriptPath}`);
      }
    }
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

export function getToolMetadataPolicyTags(tool?: ToolDefinition): string[] {
  if (tool?.metadata?.source !== 'plugin') {
    return [];
  }

  const tags = ['tool_category:plugin'];
  const pluginId = normalizePolicyTagValue(tool.metadata.pluginId || '');
  const pluginScope = normalizePolicyTagValue(tool.metadata.pluginScope || '');
  const riskLevel = tool.metadata.riskLevel;
  if (pluginId) {
    tags.push(`plugin:${pluginId}`);
  }
  if (pluginScope) {
    tags.push(`plugin_scope:${pluginScope}`);
  }
  if (riskLevel) {
    tags.push(`plugin_risk:${riskLevel}`);
  }
  return tags;
}

function normalizePolicyTagValue(value: string) {
  return value
    .trim()
    .replace(/\\/g, '/')
    .replace(/[^a-zA-Z0-9._/-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 120);
}
