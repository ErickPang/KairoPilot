import { LLMProvider, ChatMessage, ToolDefinition } from '../llm/types';
import { PermissionGuard } from '../security/permissions';

export class AgentRuntime {
  private llm: LLMProvider;
  private tools: Map<string, ToolDefinition>;
  private history: ChatMessage[] = [];
  private systemPrompt: string;
  private permissionGuard: PermissionGuard;
  private confirmAction?: (toolName: string, args: any) => Promise<boolean>;
  private auditLog?: (entry: { tool: string, args: any, result?: any, error?: string }) => void;

  constructor(
    llm: LLMProvider, 
    permissionGuard: PermissionGuard,
    systemPrompt: string = "You are a helpful AI assistant.",
    confirmAction?: (toolName: string, args: any) => Promise<boolean>,
    auditLog?: (entry: { tool: string, args: any, result?: any, error?: string }) => void
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
  async chat(userInput: string, onUpdate?: (update: any) => void): Promise<string> {
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
        for (const call of response.tool_calls) {
          const toolName = call.function.name;
          const args = JSON.parse(call.function.arguments);
          
          if (onUpdate) onUpdate({ type: 'tool-call', tool: toolName, args });
          console.log(`[Agent] Calling tool: ${toolName}`, args);
          
          const tool = this.tools.get(toolName);
          let result = "";

          if (tool) {
            try {
              // --- SECURITY CHECK ---
              await this.checkPermission(toolName, args);
              // ----------------------

              const output = await tool.execute(args);
              result = JSON.stringify(output);
              if (onUpdate) onUpdate({ type: 'tool-result', tool: toolName, result: output });
              if (this.auditLog) this.auditLog({ tool: toolName, args, result: output });
            } catch (error: any) {
              result = `Error executing tool: ${error.message}`;
              if (onUpdate) onUpdate({ type: 'tool-error', tool: toolName, error: error.message });
              if (this.auditLog) this.auditLog({ tool: toolName, args, error: error.message });
            }
          } else {
            result = `Tool ${toolName} not found.`;
            if (onUpdate) onUpdate({ type: 'tool-error', tool: toolName, error: 'Tool not found' });
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

  private async checkPermission(toolName: string, args: any) {
    // This maps specific tools to permission checks
    // For MVP, we hardcode some known tools
    if (toolName === 'read_file' || toolName === 'write_file' || toolName === 'list_directory' || toolName === 'delete_file') {
      const mode = (toolName === 'write_file' || toolName === 'delete_file') ? 'write' : 'read';
      // For list_directory, we check read permission on the path
      if (!this.permissionGuard.checkFileSystem(args.path, mode)) {
        throw new Error(`Permission Denied: File System access to ${args.path} is not allowed.`);
      }
    }
    
    if (toolName === 'execute_command') {
      if (!this.permissionGuard.checkShellCommand(args.command)) {
        throw new Error(`Permission Denied: Command '${args.command}' is not allowed.`);
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
}
