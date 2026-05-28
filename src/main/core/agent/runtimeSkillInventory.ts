import { skillsManager } from '../skills/manager';

export function isSkillInventoryQuery(userInput: string) {
  const normalized = userInput.trim().toLowerCase();
  if (!normalized) {
    return false;
  }

  return (
    /((哪些|有什么|查看|列出|看看|显示).*(技能|skill))|((技能|skill).*(哪些|有什么|列表|可用|已安装))/.test(normalized)
    || /what skills|which skills|available skills|installed skills|list skills|show skills/.test(normalized)
  );
}

export async function buildSkillInventoryResponse(agentId: string) {
  const [publicSkills, agentSkills, mergedSkills] = await Promise.all([
    skillsManager.listPublicSkills(),
    skillsManager.listAgentSkills(agentId),
    skillsManager.listMergedSkills(agentId)
  ]);
  const visiblePublicSkills = publicSkills.filter((skill) => skill.userInvocable !== false);
  const visibleAgentSkills = agentSkills.filter((skill) => skill.userInvocable !== false);
  const visibleMergedSkills = mergedSkills.filter((skill) => skill.userInvocable !== false);
  const hiddenSkillsCount = mergedSkills.length - visibleMergedSkills.length;

  if (visibleMergedSkills.length === 0) {
    return '当前没有可用技能。公共区技能 0 个，当前 Agent 专属技能 0 个。';
  }

  const publicLines = visiblePublicSkills.length > 0
    ? visiblePublicSkills.map((skill) => `- ${skill.name} (${skill.id})`)
    : ['- 无'];
  const agentLines = visibleAgentSkills.length > 0
    ? visibleAgentSkills.map((skill) => `- ${skill.name} (${skill.id})`)
    : ['- 无'];

  return [
    `当前可用技能共 ${visibleMergedSkills.length} 个。公共区技能 ${visiblePublicSkills.length} 个，当前 Agent 专属技能 ${visibleAgentSkills.length} 个。${hiddenSkillsCount > 0 ? `另有 ${hiddenSkillsCount} 个仅供自动调用的隐藏技能。` : ''}`,
    '',
    '公共区技能：',
    ...publicLines,
    '',
    '当前 Agent 专属技能：',
    ...agentLines
  ].join('\n');
}
