import type {ChatMessage,ToolDefinition,LLMUsage} from '../llm/types';
import {estimateMessagesTokens,estimateToolTokens} from '../context/requestBudget';
export class IntelligenceBudgetExceeded extends Error {}
export function reserveTokenEstimate(messages:ChatMessage[],tools:ToolDefinition[]|undefined,maxOutputTokens:number){
 return estimateMessagesTokens(messages)+estimateToolTokens(tools)+512+maxOutputTokens;
}
export function validReportedUsage(usage?:LLMUsage):usage is LLMUsage {
 return Boolean(usage)&&[usage!.prompt_tokens,usage!.completion_tokens,usage!.total_tokens].every(value=>Number.isFinite(value)&&value>=0);
}
