import type { SkillSummary } from '../../../shared/contracts';

/** Only deliberate invocations activate a skill before inference. Relevance belongs to the model. */
export function resolveExplicitSkills(input: string, skills: SkillSummary[]) {
  const text = input.replace(/```[\s\S]*?```/g, '').replace(/^\s*>.*$/gm, '');
  return skills.filter(skill => skill.userInvocable !== false && [skill.id, skill.name].some(alias => {
    if (!alias.trim()) return false;
    const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // $name anywhere, /name at the beginning of a line, or an imperative use/invoke + exact name.
    const patterns = [
      new RegExp(`(?:^|\\s)\\$${escaped}(?=$|[\\s,，。;；!！])`, 'im'),
      new RegExp(`^\\s*/${escaped}(?=$|[\\s,，。;；!！])`, 'im'),
      new RegExp(`^(?:请|请你|帮我|please\\s+)?\\s*(?:使用|调用|启用|用|use\\s+|invoke\\s+)\\s*["“]?${escaped}(?=$|[\\s"”,，。;；!！]|技能|帮我|来)`, 'im')
    ];
    return text.split('\n').some(line => !/(?:不要|别|不必|无需|do not|don't|without)\s*(?:使用|调用|启用|用|use|invoke|\$|\/)/i.test(line) && patterns.some(pattern => pattern.test(line)));
  }));
}
