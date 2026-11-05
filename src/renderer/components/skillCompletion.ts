import type { SkillSummary } from '../../shared/contracts';

export interface SlashSkillQuery { start: number; end: number; text: string }
export type SkillChoice = Pick<SkillSummary, 'id' | 'name' | 'description' | 'whenToUse'>;

export function skillDescriptionPreview(skill: SkillChoice): string {
  const description = (skill.description.trim() || skill.whenToUse).replace(/\s+/g, ' ').trim();
  const sentence = description.match(/^.*?(?:[。！？]|[.!?](?=\s|$))/u)?.[0] || description;
  const characters = Array.from(sentence);
  return characters.length > 72 ? `${characters.slice(0, 72).join('').trimEnd()}…` : sentence;
}

export function slashSkillQuery(input: string, caret: number): SlashSkillQuery | null {
  if (caret < 0 || caret > input.length) return null;
  const lineStart = input.lastIndexOf('\n', caret - 1) + 1;
  const match = /^\s*\/([^\s/]*)$/.exec(input.slice(lineStart, caret));
  if (!match) return null;
  const start = lineStart + match[0].indexOf('/');
  const remainingToken = /^[^\s]*/.exec(input.slice(caret))?.[0] || '';
  if (remainingToken.includes('/')) return null;
  return { start, end: caret + remainingToken.length, text: match[1] };
}

export function invocableSkillChoices(groups: Record<string, SkillSummary[]>): SkillChoice[] {
  // Match the runtime's merge order: workbench skills override public skills with the same ID.
  const merged = new Map<string, SkillSummary>();
  for (const skill of [...(groups.public || []), ...(groups.workbench || [])]) merged.set(skill.id, skill);
  return [...merged.values()].filter(skill => skill.userInvocable !== false)
    .map(({ id, name, description, whenToUse }) => ({ id, name, description, whenToUse }));
}

export function filterSkillChoices(skills: SkillChoice[], query: string): SkillChoice[] {
  const needle = query.normalize('NFKC').toLocaleLowerCase();
  const normalize = (value: string) => value.normalize('NFKC').toLocaleLowerCase();
  const rank = (skill: SkillChoice) => [skill.id, skill.name].some(value => normalize(value) === needle) ? 0
    : [skill.id, skill.name].some(value => normalize(value).startsWith(needle)) ? 1 : 2;
  return skills.filter(skill => [skill.id, skill.name, skill.description, skill.whenToUse].some(value => normalize(value).includes(needle)))
    .sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

// Keep explicit invocations in the existing draft string; the composer renders
// its leading commands as tokens and edits only the remaining text.
export function splitSkillInput(input: string, skills: SkillChoice[]) {
  const selected: SkillChoice[] = [];
  let offset = 0;
  while (offset < input.length) {
    const match = /^\/([^\s/]+)([ \t]|\r?\n)/.exec(input.slice(offset));
    const skill = match && skills.find(item => item.id === match[1]);
    if (!match || !skill) break;
    selected.push(skill);
    offset += match[0].length;
  }
  return { selected, text: input.slice(offset), prefix: input.slice(0, offset) };
}

export function skillInput(selected: SkillChoice[], text: string) {
  return selected.length ? `${selected.map(skill => `/${skill.id}`).join('\n')} ${text}` : text;
}

export function completeSkill(text: string, query: SlashSkillQuery, skill: SkillChoice, selected: SkillChoice[] = []) {
  const suffix = text.slice(query.end).replace(/^[ \t]/, '');
  const body = text.slice(0, query.start) + suffix;
  const next = selected.some(item => item.id === skill.id) ? selected : [...selected, skill];
  return { input: skillInput(next, body), caret: query.start };
}
