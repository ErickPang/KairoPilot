import path from 'path';
import { LLMProvider, ChatMessage, ToolDefinition } from '../llm/types';
import { PermissionGuard } from '../security/permissions';
import { normalizeExecuteCommandInput } from '../tools/shell';

export class AgentRuntime {
  private llm: LLMProvider;
  private tools: Map<string, ToolDefinition>;
  private history: ChatMessage[] = [];
  private systemPrompt: string;
  private permissionGuard: PermissionGuard;
  private confirmAction?: (
    toolName: string,
    args: Record<string, unknown>,
    options?: { sessionId?: string }
  ) => Promise<boolean>;
  private auditLog?: (entry: { tool: string, args: Record<string, unknown>, result?: unknown, error?: string, policyTags?: string[], sessionId?: string }) => void;
  private refreshSystemPrompt?: () => string | Promise<string>;

  constructor(
    llm: LLMProvider, 
    permissionGuard: PermissionGuard,
    systemPrompt: string = "You are a helpful AI assistant.",
    confirmAction?: (
      toolName: string,
      args: Record<string, unknown>,
      options?: { sessionId?: string }
    ) => Promise<boolean>,
    auditLog?: (entry: { tool: string, args: Record<string, unknown>, result?: unknown, error?: string, policyTags?: string[], sessionId?: string }) => void,
    refreshSystemPrompt?: () => string | Promise<string>
  ) {
    this.llm = llm;
    this.systemPrompt = systemPrompt;
    this.permissionGuard = permissionGuard;
    this.confirmAction = confirmAction;
    this.auditLog = auditLog;
    this.refreshSystemPrompt = refreshSystemPrompt;
    this.tools = new Map();
  }

  // Register a tool (capability)
  registerTool(tool: ToolDefinition) {
    this.tools.set(tool.name, tool);
  }

  // Get current history
  getHistory(): ChatMessage[] {
    return this.history;
  }

  // Set history (for session restore)
  setHistory(history: ChatMessage[]) {
    this.history = history;
  }

  // The main loop: This is where the magic happens
  async chat(
    userInput: string,
    onUpdate?: (update: Record<string, unknown>) => void,
    options?: { sessionId?: string }
  ): Promise<string> {
    if (this.refreshSystemPrompt) {
      const latestSystemPrompt = await this.refreshSystemPrompt();
      if (typeof latestSystemPrompt === 'string' && latestSystemPrompt.trim().length > 0) {
        this.systemPrompt = latestSystemPrompt;
      }
    }
    // 1. Add user message to history
    const userMessage: ChatMessage = { role: 'user', content: userInput };
    this.history.push(userMessage);

    // 2. Prepare context (System Prompt + History)
    const context: ChatMessage[] = [
      { role: 'system', content: this.systemPrompt },
      ...this.history
    ];

    let finalResponse = "";
    let iterations = 0;
    const MAX_ITERATIONS = 8;

    while (iterations < MAX_ITERATIONS) {
      iterations++;

      // 3. Prepare tools for LLM (convert Zod to JSON Schema)
      // We need to adapt our internal ToolDefinition to OpenAI's expected format
      // Here we assume LLMProvider handles the actual conversion if needed, 
      // but passing full ToolDefinition is better.
      const availableTools = Array.from(this.tools.values());

      // 4. Call LLM
      if (onUpdate) onUpdate({ type: 'thinking', content: `Processing... (Iteration ${iterations})` });
      console.log(`[Agent] Thinking... (Iteration ${iterations})`);
      const response = await this.llm.chat(context, availableTools);
      
      // 5. Add assistant response to history
      this.history.push(response);
      context.push(response); // Keep context in sync

      // 6. Check if LLM wants to use a tool
      if (response.tool_calls && response.tool_calls.length > 0) {
        for (const rawCall of response.tool_calls) {
          const call = rawCall as { id: string; function: { name: string; arguments: string } };
          const toolName = call.function.name;
          const tool = this.tools.get(toolName);
          let args: Record<string, unknown> = {};
          let result = "";

          try {
            const rawArgs = call.function.arguments;
            if (typeof rawArgs === 'string' && rawArgs.trim().length > 0) {
              const parsedArgs = JSON.parse(rawArgs);
              args = parsedArgs && typeof parsedArgs === 'object' ? parsedArgs as Record<string, unknown> : {};
            }
          } catch (error) {
            const errorMessage = `Invalid JSON arguments for ${toolName}: ${error instanceof Error ? error.message : 'Unknown error'}`;
            result = `Error executing tool: ${errorMessage}`;
            if (onUpdate) onUpdate({ type: 'tool-error', tool: toolName, error: errorMessage });
            if (this.auditLog) this.auditLog({ tool: toolName, args, error: errorMessage, policyTags: [`tool:${toolName}`, 'decision:error'], sessionId: options?.sessionId });
            const toolMessage: ChatMessage = {
              role: 'tool',
              content: result,
              name: toolName,
              tool_call_id: call.id
            };
            this.history.push(toolMessage);
            context.push(toolMessage);
            continue;
          }

          if (!tool) {
            result = `Tool ${toolName} not found.`;
            if (onUpdate) onUpdate({ type: 'tool-error', tool: toolName, error: 'Tool not found' });
            const toolMessage: ChatMessage = {
              role: 'tool',
              content: result,
              name: toolName,
              tool_call_id: call.id
            };
            this.history.push(toolMessage);
            context.push(toolMessage);
            continue;
          }

          args = this.repairToolArgs(toolName, args, context);
          const validation = tool.parameters.safeParse(args);
          if (!validation.success) {
            const issueText = validation.error.issues
              .map(issue => `${issue.path.join('.') || 'root'}: ${issue.message}`)
              .join('; ');
            const errorMessage = `Invalid arguments for ${toolName}: ${issueText}`;
            result = `Error executing tool: ${errorMessage}`;
            if (onUpdate) onUpdate({ type: 'tool-error', tool: toolName, error: errorMessage });
            if (this.auditLog) this.auditLog({ tool: toolName, args, error: errorMessage, policyTags: [`tool:${toolName}`, 'decision:error'], sessionId: options?.sessionId });
            const toolMessage: ChatMessage = {
              role: 'tool',
              content: result,
              name: toolName,
              tool_call_id: call.id
            };
            this.history.push(toolMessage);
            context.push(toolMessage);
            continue;
          }

          args = validation.data as Record<string, unknown>;
          const policyTags = this.getPolicyTags(toolName, args);
          if (onUpdate) onUpdate({ type: 'tool-call', tool: toolName, args });
          console.log(`[Agent] Calling tool: ${toolName}`, args);

          try {
            await this.checkPermission(toolName, args, options);
            const output = await tool.execute(args);
            result = JSON.stringify(output);
            if (onUpdate) onUpdate({ type: 'tool-result', tool: toolName, result: output });
            if (this.auditLog) this.auditLog({ tool: toolName, args, result: output, policyTags, sessionId: options?.sessionId });
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            result = `Error executing tool: ${errorMessage}`;
            if (onUpdate) onUpdate({ type: 'tool-error', tool: toolName, error: errorMessage });
            if (this.auditLog) this.auditLog({ tool: toolName, args, error: errorMessage, policyTags: [...policyTags, 'decision:error'], sessionId: options?.sessionId });
          }

          // 7. Feed tool result back to LLM
          const toolMessage: ChatMessage = {
            role: 'tool',
            content: result,
            name: toolName,
            tool_call_id: call.id // OpenAI requires this ID to match the tool call
          };

          this.history.push(toolMessage);
          context.push(toolMessage);
        }
        // Loop continues to let LLM process the tool result
      } else {
        // No tool calls? We are done.
        finalResponse = response.content;
        if (this.shouldBlockSensitiveDisclosure(userInput, finalResponse)) {
          finalResponse = 'I can’t disclose hidden system instructions or internal memory. I can provide a high-level summary of my safety and behavior policy instead.';
        }
        break;
      }
    }

    if (!finalResponse.trim()) {
      finalResponse = await this.finalizeWithoutTools(context, userInput, onUpdate);
    }

    if (!finalResponse.trim()) {
      finalResponse = '我已经完成了技能相关的工具调用，但未能在限制轮次内生成最终答复。请重试，或让我直接基于当前已收集的信息给出结论。';
    }

    return finalResponse;
  }

  private async finalizeWithoutTools(
    context: ChatMessage[],
    userInput: string,
    onUpdate?: (update: Record<string, unknown>) => void
  ) {
    try {
      if (onUpdate) onUpdate({ type: 'thinking', content: 'Summarizing gathered results...' });
      const finalPass = await this.llm.chat([
        ...context,
        {
          role: 'user',
          content: '请基于以上已有上下文和工具结果，直接给出最终答复，不要再调用任何工具。如果信息不足，也请明确说明已确认的结论与缺失的信息。'
        }
      ]);

      const content = finalPass.content.trim();
      if (!content) {
        return '';
      }

      const sanitizedContent = this.shouldBlockSensitiveDisclosure(userInput, content)
        ? 'I can’t disclose hidden system instructions or internal memory. I can provide a high-level summary of my safety and behavior policy instead.'
        : content;

      this.history.push({
        role: 'assistant',
        content: sanitizedContent,
        model: finalPass.model,
        usage: finalPass.usage
      });

      return sanitizedContent;
    } catch {
      return '';
    }
  }

  private async checkPermission(
    toolName: string,
    args: Record<string, unknown>,
    options?: { sessionId?: string }
  ) {
    // This maps specific tools to permission checks
    // For MVP, we hardcode some known tools
    if (toolName === 'read_file' || toolName === 'write_file' || toolName === 'list_directory' || toolName === 'delete_file') {
      const mode = (toolName === 'write_file' || toolName === 'delete_file') ? 'write' : 'read';
      // For list_directory, we check read permission on the path
      const path = (args.path || args.file_path) as string;
      if (!this.permissionGuard.checkFileSystem(path, mode)) {
        throw new Error(`Permission Denied: File System access to ${path} is not allowed.`);
      }
    }
    
    if (toolName === 'execute_command') {
      const normalizedCommand = normalizeExecuteCommandInput(args);
      args.command = normalizedCommand.command;
      args.args = normalizedCommand.args;
      if (!this.permissionGuard.checkShellCommand(normalizedCommand.command)) {
        throw new Error(`Permission Denied: Command '${normalizedCommand.command}' is not allowed.`);
      }
    }

    if (toolName === 'run_skill_script') {
      const scriptPath = typeof args.scriptPath === 'string' ? args.scriptPath.trim().toLowerCase() : ''
      let command = typeof args.command === 'string' ? args.command.trim() : ''
      if (!command) {
        if (scriptPath.endsWith('.js') || scriptPath.endsWith('.mjs') || scriptPath.endsWith('.cjs')) {
          command = 'node'
        } else if (scriptPath.endsWith('.py')) {
          command = 'python3'
        } else if (scriptPath.endsWith('.sh')) {
          command = 'bash'
        }
      }
      if (!command) {
        throw new Error('Permission Denied: Skill script command is required.')
      }
      if (!this.permissionGuard.checkShellCommand(command)) {
        throw new Error(`Permission Denied: Command '${command}' is not allowed.`)
      }
    }

    if (toolName === 'web_search' || toolName === 'fetch_webpage') {
      const urlToCheck = (args.url || 'https://duckduckgo.com') as string;
      if (!this.permissionGuard.checkNetwork(urlToCheck)) {
        throw new Error('Real-time web access is disabled for this agent. Enable network permission in Agent configuration before requesting latest or current information.');
      }
    }

    // --- HUMAN-IN-THE-LOOP CHECK ---
    // High-risk tools require explicit user confirmation
    const highRiskTools = ['execute_command', 'write_file', 'delete_file', 'run_skill_script'];
    if (highRiskTools.includes(toolName) && this.confirmAction) {
      console.log(`[Agent] Requesting confirmation for ${toolName}`);
      const approved = await this.confirmAction(toolName, args, options);
      if (!approved) {
        throw new Error(`User denied permission for ${toolName}.`);
      }
    }

    // Add more checks as needed
  }

  private repairToolArgs(toolName: string, args: Record<string, unknown>, context: ChatMessage[]): Record<string, unknown> {
    if (toolName === 'execute_command') {
      try {
        const normalizedCommand = normalizeExecuteCommandInput(args);
        return {
          ...args,
          command: normalizedCommand.command,
          args: normalizedCommand.args
        };
      } catch {
        return args;
      }
    }

    if (toolName === 'run_skill_script') {
      const scriptPath = typeof args.scriptPath === 'string' ? args.scriptPath.trim() : '';
      if (!scriptPath) {
        return args;
      }

      const extension = path.extname(scriptPath).toLowerCase();
      const command = extension === '.py'
        ? 'python3'
        : extension === '.sh'
          ? 'bash'
          : extension === '.js' || extension === '.mjs' || extension === '.cjs'
            ? 'node'
            : '';

      if (!command) {
        return args;
      }

      return {
        ...args,
        command
      };
    }

    if (toolName !== 'web_search') {
      return args;
    }
    const latestUserQuery = this.getLatestUserQuery(context);
    const requestedQuery = typeof args.query === 'string' && args.query.trim().length > 0
      ? args.query.trim()
      : latestUserQuery;
    if (!requestedQuery) {
      return args;
    }

    return {
      ...args,
      query: this.buildSearchQuery(requestedQuery)
    };
  }

  private getLatestUserQuery(context: ChatMessage[]): string {
    for (let i = context.length - 1; i >= 0; i -= 1) {
      const message = context[i];
      if (message.role === 'user') {
        const text = typeof message.content === 'string' ? message.content.trim() : '';
        if (text) {
          return text;
        }
      }
    }
    return '';
  }

  private getPolicyTags(toolName: string, args: Record<string, unknown>): string[] {
    const tags = [`tool:${toolName}`];
    if (toolName === 'load_skill' || toolName === 'read_skill_resource' || toolName === 'run_skill_script') {
      tags.push('policy:skill_used');
      tags.push('tool_category:skill');
    }

    const highRiskTools = ['execute_command', 'write_file', 'delete_file', 'run_skill_script'];
    if (highRiskTools.includes(toolName)) {
      tags.push('risk:high');
      tags.push('policy:confirmation_required');
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

  private buildSearchQuery(query: string): string {
    const normalizedQuery = query.trim();
    if (!normalizedQuery) {
      return query;
    }

    if (!this.isRecencyQuery(normalizedQuery)) {
      return normalizedQuery;
    }

    const now = new Date();
    const currentYear = String(now.getFullYear());
    const currentMonth = String(now.getMonth() + 1).padStart(2, '0');
    const currentDate = `${currentYear}-${currentMonth}-${String(now.getDate()).padStart(2, '0')}`;
    const lowerCaseQuery = normalizedQuery.toLowerCase();
    const hasExplicitYear = /\b20\d{2}\b/.test(normalizedQuery);
    const hasExplicitIsoDate = /\b20\d{2}-\d{2}-\d{2}\b/.test(normalizedQuery);
    const isChineseQuery = /[\u4e00-\u9fff]/.test(normalizedQuery);
    const suffixTerms = new Set<string>();

    if (!hasExplicitYear) {
      suffixTerms.add(currentYear);
    }
    if (!hasExplicitIsoDate && (lowerCaseQuery.includes('today') || normalizedQuery.includes('今天'))) {
      suffixTerms.add(currentDate);
    }
    if (isChineseQuery) {
      suffixTerms.add('最新');
      suffixTerms.add('当前');
    } else {
      suffixTerms.add('latest');
      suffixTerms.add('current');
    }

    const suffix = Array.from(suffixTerms)
      .filter(term => term && !normalizedQuery.toLowerCase().includes(term.toLowerCase()))
      .join(' ');

    return suffix ? `${normalizedQuery} ${suffix}` : normalizedQuery;
  }

  private isRecencyQuery(query: string): boolean {
    const recencyPattern = /\b(latest|current|recent|today|this week|this month|this year|release notes|changelog|docs?|documentation|pricing|news|update)\b/i;
    return recencyPattern.test(query) || /最新|当前|最近|今天|本周|本月|今年|文档|教程|发布说明|更新|新闻|价格|行情/.test(query);
  }

  private shouldBlockSensitiveDisclosure(userInput: string, assistantOutput: string): boolean {
    const normalizedUserInput = (userInput || '').toLowerCase();
    if (!normalizedUserInput.trim()) {
      return false;
    }
    const extractionPatterns = [
      'system prompt',
      'developer prompt',
      'hidden prompt',
      'internal prompt',
      'show your prompt',
      'reveal prompt',
      'print prompt',
      '输出系统提示词',
      '显示系统提示词',
      '泄露提示词',
      '泄露系统',
      '提示词原文',
      '开发者指令',
      '隐藏指令',
      '越狱'
    ];
    const isExtractionAttempt = extractionPatterns.some(pattern => normalizedUserInput.includes(pattern));
    if (!isExtractionAttempt) {
      return false;
    }

    const normalizedOutput = (assistantOutput || '').toLowerCase();
    const sensitiveMarkers = [
      '<core_identity>',
      '<instruction_priority>',
      '<security_and_behavior_rules>',
      '<conflict_resolution_protocol>',
      '<skills_instructions>',
      '<core_directives>',
      '<identity>',
      '<session_user_context>',
      '<session_soul_context>',
      '<long_term_memory>',
      '<environment>'
    ];
    if (sensitiveMarkers.some(marker => normalizedOutput.includes(marker))) {
      return true;
    }

    const promptPrefix = this.systemPrompt.slice(0, 120).toLowerCase();
    return promptPrefix.length > 40 && normalizedOutput.includes(promptPrefix);
  }
}
