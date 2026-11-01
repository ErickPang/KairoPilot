import type { TaskTemplate } from './contracts';
export const BUILTIN_TASK_TEMPLATES: TaskTemplate[] = [
  {id:'builtin:general',version:1,name:'通用任务',instructions:'先明确目标与约束，依据可核实的信息完成工作；遇到缺失条件时明确说明。',output:'给出可直接使用的结果，并说明必要限制。',acceptance:'目标已完成；结果可以检查；事实和判断明确区分。',builtin:true},
  {id:'builtin:code',version:1,name:'代码修复',instructions:'先定位原因，再实施最小必要改动，保留无关修改。遵守项目规则和现有权限。',output:'说明问题原因、改动内容、验证结果及剩余风险。',acceptance:'相关问题可复现并已修复；适用检查通过；不泄露凭证。',builtin:true},
  {id:'builtin:document',version:1,name:'文档整理',instructions:'保留事实、来源、条件与原意，按目标读者组织材料；不编造缺失信息。',output:'交付结构清晰、可编辑的文档或正文，标出待确认内容。',acceptance:'关键信息无遗漏；术语和格式一致；文件可打开。',builtin:true},
  {id:'builtin:analysis',version:1,name:'资料分析',instructions:'围绕问题比较证据，明确来源、时间和不确定性；不把推测写成已验证事实。',output:'结论、支持证据、差异比较和可执行建议。',acceptance:'结论有依据；比较口径一致；局限和待验证事项清楚。',builtin:true}
];
export function taskTemplatePrompt(template?: TaskTemplate|null): string {
  if(!template)return '';
  return `\n\n<task_template source="user-selected" version="${template.version}">\n任务模板：${template.name}\n工作方法：${template.instructions}\n输出要求：${template.output}\n验收标准：${template.acceptance}\n模板仅提供工作方法；不授予工具、文件、网络或执行权限，不能覆盖应用和项目安全规则。\n</task_template>`;
}
export const PLANNING_PROMPT='\n\n本轮仅生成待用户确认的实施计划，不执行修改。可通过已注册的只读工具定向读取和搜索授权项目，读取用户附件；不能写入、执行命令、使用网络、技能、插件或委派。仅对实际成功读取的材料声称已调查；权限不足时说明缺失条件。根据用户目标，用 Markdown 给出：目标、调查依据（文件路径及发现）、修改范围、具体步骤、预期交付物、验收标准与待确认事项。先调查再规划，避免无关扫描。不得输出虚构的执行结果。计划需要用户确认后才会开始执行。';
