import { getDb } from './chat';

export interface AgentStats {
  agentId: string;
  totalSessions: number;
  totalMessages: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export function getAgentStats(): AgentStats[] {
  // We need to query sessions and messages
  // But wait, chat.ts doesn't export getDb directly.
  // Let's just write this in chat.ts or modify chat.ts to export getDb.
}