import {z} from 'zod';
import type {ChatMessage,ToolDefinition} from '../llm/types';

export const DEFAULT_CONTEXT_TOKENS=65536;
export const DEFAULT_OUTPUT_TOKENS=4096;
export class ContextBudgetExceeded extends Error {
  constructor(detail:string){super(`CONTEXT_BUDGET_EXCEEDED: ${detail}`);this.name='ContextBudgetExceeded';}
}
export function toolSchemas(tools:ToolDefinition[]=[]){
  return tools.map(tool=>{
    let parameters:Record<string,unknown>;
    try {parameters={...(tool.parametersJsonSchema||z.toJSONSchema(tool.parameters))};delete parameters.$schema;}
    catch {parameters={type:'object',properties:{},additionalProperties:true};}
    if(typeof parameters.type!=='string')parameters={type:'object',properties:{},additionalProperties:true};
    return {type:'function' as const,function:{name:tool.name,description:tool.description,parameters}};
  });
}
/** Conservative UTF-8 estimate, not a tokenizer count or billing measurement. */
export function estimateMessagesTokens(messages:ChatMessage[]){
  return messages.reduce((sum,message)=>sum+Buffer.byteLength(JSON.stringify({role:message.role,content:message.content,name:message.name,tool_calls:message.tool_calls,tool_call_id:message.tool_call_id}),'utf8')+32
    // Vision cost depends on model and resolution. Reserve locally; do not call it exact usage.
    +(message.attachments?.filter(item=>item.kind==='image').length||0)*8192,0);
}
export function estimateToolTokens(tools:ToolDefinition[]=[]){return tools.length?Buffer.byteLength(JSON.stringify(toolSchemas(tools)),'utf8')+64:0;}
export function requestLimits(contextWindowTokens?:number,maxOutputTokens=DEFAULT_OUTPUT_TOKENS){
  const hasLimit=typeof contextWindowTokens==='number'&&Number.isFinite(contextWindowTokens)&&contextWindowTokens>0;
  const contextTokens=hasLimit?Math.floor(contextWindowTokens):DEFAULT_CONTEXT_TOKENS;
  const outputTokens=Math.min(maxOutputTokens,Math.max(1,Math.floor(contextTokens/4)));
  const safetyTokens=Math.max(256,Math.ceil(contextTokens*0.03));
  return {contextTokens,outputTokens,safetyTokens,inputLimitTokens:contextTokens-outputTokens-safetyTokens,source:hasLimit?'model_limit' as const:'local_fallback' as const};
}
export function assertRequestFits(messages:ChatMessage[],tools:ToolDefinition[]=[],contextWindowTokens?:number,maxOutputTokens?:number){
  const limits=requestLimits(contextWindowTokens,maxOutputTokens);
  const messageTokens=estimateMessagesTokens(messages),toolTokens=estimateToolTokens(tools);
  if(messageTokens+toolTokens>limits.inputLimitTokens)throw new ContextBudgetExceeded('Instructions, current input and requested tools do not fit. Shorten the input or instructions, or load fewer tools. Nothing was silently removed from the protected instructions.');
  return {...limits,messageTokens,toolTokens,estimatedInputTokens:messageTokens+toolTokens,estimator:'utf8_bytes_with_vision_reserve' as const};
}
