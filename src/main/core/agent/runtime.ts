import { LLMProvider, ChatMessage, ToolDefinition } from '../llm/types';
import { PermissionGuard } from '../security/permissions';

export class AgentRuntime {
  private llm: LLMProvider;
  private tools: Map<string, ToolDefinition>;
  private history: ChatMessage[] = [];
  private systemPrompt: string;
  private permissionGuard: PermissionGuard;
  private confirmAction?: (toolName: string, args: Record<string, unknown>) => Promise<boolean>;
  private auditLog?: (entry: { tool: string, args: Record<string, unknown>, result?: unknown, error?: string, policyTags?: string[] }) => void;

  constructor(
    llm: LLMProvider, 
    permissionGuard: PermissionGuard,
    systemPrompt: string = "You are a helpful AI assistant.",
    confirmAction?: (toolName: string, args: Record<string, unknown>) => Promise<boolean>,
    auditLog?: (entry: { tool: string, args: Record<string, unknown>, result?: unknown, error?: string, policyTags?: string[] }) => void
  ) {
    this.llm = llm;
    this.systemPrompt = systemPrompt;
    this.permissionGuard = permissionGuard;
    this.confirmAction = confirmAction;
    this.auditLog = auditLog;
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
  async chat(userInput: string, onUpdate?: (update: Record<string, unknown>) => void): Promise<string> {
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
    const MAX_ITERATIONS = 5; // Prevent infinite loops

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
            if (this.auditLog) this.auditLog({ tool: toolName, args, error: errorMessage, policyTags: [`tool:${toolName}`, 'decision:error'] });
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
            if (this.auditLog) this.auditLog({ tool: toolName, args, error: errorMessage, policyTags: [`tool:${toolName}`, 'decision:error'] });
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
            await this.checkPermission(toolName, args);
            const output = await tool.execute(args);
            result = JSON.stringify(output);
            if (onUpdate) onUpdate({ type: 'tool-result', tool: toolName, result: output });
            if (this.auditLog) this.auditLog({ tool: toolName, args, result: output, policyTags });
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            result = `Error executing tool: ${errorMessage}`;
            if (onUpdate) onUpdate({ type: 'tool-error', tool: toolName, error: errorMessage });
            if (this.auditLog) this.auditLog({ tool: toolName, args, error: errorMessage, policyTags: [...policyTags, 'decision:error'] });
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
        break;
      }
    }

    return finalResponse;
  }

  private async checkPermission(toolName: string, args: Record<string, unknown>) {
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
        const cmd = args.command as string;
        if (!this.permissionGuard.checkShellCommand(cmd)) {
        throw new Error(`Permission Denied: Command '${args.command}' is not allowed.`);
      }
    }

    if (toolName === 'web_search' || toolName === 'fetch_webpage') {
      // By default, let's allow search if network is not strictly blocked, 
      // or we can use checkNetwork if it's strictly enforced.
      // We pass the URL or a dummy domain to check if network is enabled.
      const urlToCheck = (args.url || 'https://duckduckgo.com') as string;
      if (!this.permissionGuard.checkNetwork(urlToCheck)) {
        throw new Error(`Permission Denied: Network access to ${urlToCheck} is not allowed.`);
      }
    }

    // --- HUMAN-IN-THE-LOOP CHECK ---
    // High-risk tools require explicit user confirmation
    const highRiskTools = ['execute_command', 'write_file', 'delete_file'];
    if (highRiskTools.includes(toolName) && this.confirmAction) {
      console.log(`[Agent] Requesting confirmation for ${toolName}`);
      const approved = await this.confirmAction(toolName, args);
      if (!approved) {
        throw new Error(`User denied permission for ${toolName}.`);
      }
    }

    // Add more checks as needed
  }

  private repairToolArgs(toolName: string, args: Record<string, unknown>, context: ChatMessage[]): Record<string, unknown> {
    if (toolName !== 'web_search') {
      return args;
    }
    if (typeof args.query === 'string' && args.query.trim().length > 0) {
      return args;
    }
    const latestUserQuery = this.getLatestUserQuery(context);
    if (!latestUserQuery) {
      return args;
    }
    return {
      ...args,
      query: latestUserQuery
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
    if (toolName.startsWith('skill_')) {
      tags.push('policy:skill_used');
      tags.push('tool_category:skill');
    }

    const highRiskTools = ['execute_command', 'write_file', 'delete_file'];
    if (highRiskTools.includes(toolName)) {
      tags.push('risk:high');
      tags.push('policy:confirmation_required');
    }

    if (toolName === 'execute_command' && typeof args.command === 'string') {
      tags.push(`command:${(args.command as string).split(' ')[0]}`);
    }

    return tags;
  }
}
