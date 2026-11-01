import {describe,it,expect} from 'vitest';
import {isExplicitDelegation} from './delegationPolicy';
describe('manual delegation requires a direct request',()=>{
 it.each(['请委派两个只读子任务','并行调查这两个模块','Please delegate these two investigations','use subagents for review',
  '请帮我委派两个只读调查','请用两个子智能体分析模块','现在请帮我使用 2 个只读子任务核对资料','麻烦你调用两位子智能体分别调查','Could you please use two subagents for independent reviews?',
  '请用两个子智能体调查，不要写文件'])('accepts %s',input=>expect(isExplicitDelegation(input)).toBe(true));
 it.each(['不要委派，直接回答','请不要并行处理','请解释“委派”是什么','Summarize this: please delegate work','do not use subagents',
  '请帮我不要委派，直接检查','请用两个子智能体是什么意思','委派是什么意思','“请帮我委派两个子任务”是个示例','使用子智能体的含义','Please explain how to use subagents',
  '如果有必要，可以考虑委派','只分析这句话：请用两个子智能体'])('rejects %s',input=>expect(isExplicitDelegation(input)).toBe(false));
});
