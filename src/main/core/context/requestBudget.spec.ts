import {describe,expect,it} from 'vitest';
import {z} from 'zod';
import {assertRequestFits,estimateMessagesTokens,estimateToolTokens,requestLimits,ContextBudgetExceeded} from './requestBudget';
import {assembleRuntimeContext} from './assembler';
import type {ChatMessage,ToolDefinition} from '../llm/types';
const base={systemPrompt:'Keep all approval requirements.',workspace:'/nonexistent-kairo-budget-test',canReadWorkspacePath:()=>false};
const tool:ToolDefinition={name:'probe',description:'A synthetic probe',parameters:z.object({value:z.string()}),execute:async()=>null};
describe('whole request budgeting',()=>{
 it('accounts for UTF-8, tool schemas, output and safety reserves with explicit limits',()=>{const messages:ChatMessage[]=[{role:'user',content:'中文'}];const budget=assertRequestFits(messages,[tool],4096);expect(estimateMessagesTokens(messages)).toBeGreaterThan(estimateMessagesTokens([{role:'user',content:'ab'}]));expect(budget.toolTokens).toBe(estimateToolTokens([tool]));expect(budget.estimatedInputTokens+budget.outputTokens+budget.safetyTokens).toBeLessThanOrEqual(4096);expect(budget.source).toBe('model_limit');expect(requestLimits().source).toBe('local_fallback');});
 it('rejects schemas that consume the request budget before any model request',()=>{expect(()=>assertRequestFits([{role:'user',content:'ok'}],[{...tool,description:'x'.repeat(10000)}],4096)).toThrow(ContextBudgetExceeded);});
 it('reserves vision input separately without calling it billed usage',()=>{const message:ChatMessage={role:'user',content:'image',attachments:[{id:'i',kind:'image',name:'image',sessionId:'s',mimeType:'image/png',size:20,storedPath:'/synthetic.png',contentHash:'x',createdAt:1}]};expect(estimateMessagesTokens([message])).toBeGreaterThan(8192);});
 it('keeps the current user and tool-call/result pairs while omitting oversized old turns',()=>{
  const result=assembleRuntimeContext({...base,modelContextWindowTokens:4096,history:[{role:'user',content:'OLD'.repeat(2000)},{role:'assistant',content:'old reply'},{role:'user',content:'CURRENT_APPROVAL_REQUIREMENT'},{role:'assistant',content:'',tool_calls:[{id:'call',function:{name:'probe',arguments:'{}'}}]},{role:'tool',tool_call_id:'call',name:'probe',content:'short result'}],tools:[tool]});
  expect(result.messages.some(message=>message.content==='CURRENT_APPROVAL_REQUIREMENT')).toBe(true);expect(result.messages.some(message=>message.role==='user'&&message.content.includes('OLDOLD'))).toBe(false);expect(result.messages.some(message=>message.tool_calls?.[0]?.id==='call')).toBe(true);expect(result.messages.some(message=>message.tool_call_id==='call')).toBe(true);expect(result.metadata.budget.request!.estimatedInputTokens).toBeLessThanOrEqual(result.metadata.budget.request!.inputLimitTokens);
 });
 it('fails explicitly rather than truncating rules, skill approval requirements or the current user',()=>{
  for(const input of [{...base,systemPrompt:'R'.repeat(20000),history:[{role:'user' as const,content:'ok'}]},{...base,history:[{role:'user' as const,content:'U'.repeat(20000)}]},{...base,history:[{role:'user' as const,content:'ok'}],loadedSkills:[{skillName:'large',instructions:'S'.repeat(20000)+'NEVER_PUBLISH_WITHOUT_APPROVAL',allowedTools:[],loadedAt:1}]}])expect(()=>assembleRuntimeContext({...input,modelContextWindowTokens:4096})).toThrow(ContextBudgetExceeded);
 });
 it('retains the full selected skill body, including its final restriction and line breaks',()=>{const instructions='# Instructions\n'+('detail\n'.repeat(1400))+'Never publish without approval.';const result=assembleRuntimeContext({...base,history:[{role:'user',content:'work'}],loadedSkills:[{skillName:'large',instructions,allowedTools:[],loadedAt:1}]});expect(result.messages.find(message=>message.content.includes('<active_skill_instructions>'))?.content).toContain(instructions);});
 it('drops orphan tool results and marks a shortened tool response without changing its stored original',()=>{const original:ChatMessage={role:'tool',tool_call_id:'call',content:'x'.repeat(25000)};const result=assembleRuntimeContext({...base,history:[{role:'tool',tool_call_id:'orphan',content:'ORPHAN'},{role:'user',content:'CURRENT'},{role:'assistant',content:'',tool_calls:[{id:'call'}]},original]});expect(result.messages.some(message=>message.content==='ORPHAN')).toBe(false);expect(result.messages.find(message=>message.role==='tool')?.content).toContain('Original result remains');expect(original.content).toHaveLength(25000);});
 it('does not replay unfinished or partially returned tool-call envelopes from an interrupted turn',()=>{
  const result=assembleRuntimeContext({...base,history:[{role:'user',content:'old task'},{role:'assistant',content:'',tool_calls:[{id:'a'},{id:'b'}]},{role:'tool',tool_call_id:'a',content:'partial result'},{role:'user',content:'new task'}]});
  expect(result.messages.some(message=>message.tool_calls?.length||message.role==='tool')).toBe(false);expect(result.messages.some(message=>message.content==='new task')).toBe(true);
 });

});
