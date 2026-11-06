/** Parse only known leading slash invocations, leaving paths and prose intact. */
export function splitSkillInput<T extends { id: string; name: string }>(input: string, skills: T[], allowBare = false) {
  const selected: T[] = [];
  let offset = 0;
  while (offset < input.length) {
    // The composer keeps a bare name editable for completion; sent text is trimmed.
    const pattern = allowBare ? /^\/([^\s/]+)(?:[ \t]|\r?\n|$)/ : /^\/([^\s/]+)(?:[ \t]|\r?\n)/;
    const match = pattern.exec(input.slice(offset));
    const skill = match && skills.find(item => item.id === match[1]);
    if (!match || !skill) break;
    selected.push(skill);
    offset += match[0].length;
  }
  return { selected, text: input.slice(offset), prefix: input.slice(0, offset) };
}
