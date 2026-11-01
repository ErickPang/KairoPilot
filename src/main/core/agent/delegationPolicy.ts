export function isExplicitDelegation(input:string) {
  if(/(?:不要|禁止|不需要|别|do not|don't|without).{0,16}(?:委派|子任务|子智能体|并行|delegat|subagent)/i.test(input))return false;
  const command=input.trim().replace(/^(?:(?:请你|请|帮我|帮忙|麻烦你|麻烦|开始|现在)\s*|(?:please|could you|can you)\s+)+/i,'');
  const match=/^(?:委派|并行|(?:使用|用|启用|启动|安排|调用|让)\s*(?:[一二三四五六七八九十两\d]+\s*(?:个|位)?\s*)?(?:只读\s*)?(?:子任务|子智能体)|delegate\b|spawn\b|use\s+(?:(?:one|two|\d+)\s+)?subagents?\b)/i.exec(command);
  if(!match)return false;
  // Term explanations and quoted examples do not authorize execution.
  return !/^\s*(?:是什么|是什么意思|什么意思|的(?:意思|含义)|是指|means?\b)/i.test(command.slice(match[0].length));
}
