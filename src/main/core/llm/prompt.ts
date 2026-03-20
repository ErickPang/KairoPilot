import fs from 'fs';
import path from 'path';

export interface PromptContext {
  workspace: string;
  agentPrompt: string; // The UI-configured prompt or KAIROPILOT.md
}

export class PromptBuilder {
  private static readonly BASE_SYSTEM_PROMPT = `<core_identity>
You are KairoPilot, a secure desktop AI assistant.
</core_identity>

<security_and_behavior_rules>
- You operate in a sandboxed environment. Respect workspace boundaries.
- Never execute destructive commands without explicit user consent.
- Use provided tools efficiently. Do not guess file contents, read them.
- Always follow the workspace instructions provided in KAIROPILOT.md.
</security_and_behavior_rules>`;

  static buildSystemPrompt(context: PromptContext): string {
    const parts: string[] = [this.BASE_SYSTEM_PROMPT];

    // 1. Inject KAIROPILOT.md (Workspace Instructions)
    // It should be passed as agentPrompt since we sync it in config.ts
    if (context.agentPrompt && context.agentPrompt.trim()) {
      parts.push(`<workspace_instructions>\n${context.agentPrompt.trim()}\n</workspace_instructions>`);
    }

    // 2. Inject MEMORY.md (Dynamic memory context)
    if (context.workspace) {
      const memoryPath = path.join(context.workspace, 'MEMORY.md');
      if (fs.existsSync(memoryPath)) {
        try {
          const memoryContent = fs.readFileSync(memoryPath, 'utf-8');
          if (memoryContent.trim()) {
            parts.push(`<long_term_memory>\n${memoryContent.trim()}\n</long_term_memory>`);
          }
        } catch (e) {
          console.error('Failed to read MEMORY.md:', e);
        }
      }
    }

    // 3. Inject Environment Info
    parts.push(`<environment>\nCurrent Workspace: ${context.workspace}\n</environment>`);

    return parts.join('\n\n');
  }
}
