import { describe, expect, it } from 'vitest'
import type { SkillSummary } from '../../../shared/contracts'
import { resolveExplicitSkills } from './resolver'

function createSkill(overrides: Partial<SkillSummary> & Pick<SkillSummary, 'id' | 'name'>): SkillSummary {
  return {
    id: overrides.id,
    name: overrides.name,
    description: overrides.description ?? `${overrides.name} description`,
    version: overrides.version,
    allowedTools: overrides.allowedTools ?? [],
    whenToUse: overrides.whenToUse ?? overrides.description ?? `${overrides.name} description`,
    arguments: overrides.arguments ?? [],
    userInvocable: overrides.userInvocable ?? true,
    modelInvocable: overrides.modelInvocable ?? true,
    executionMode: overrides.executionMode ?? 'inline',
    content: overrides.content ?? `# ${overrides.name}`,
    source: overrides.source ?? 'public',
    skillDir: overrides.skillDir ?? `/skills/${overrides.id}`,
    skillFilePath: overrides.skillFilePath ?? `/skills/${overrides.id}/SKILL.md`
  }
}

describe('explicit skill invocation',()=>{
 const skills=[createSkill({id:'release-checklist',name:'Release Checklist'}),createSkill({id:'audit',name:'Audit'}),createSkill({id:'hidden',name:'Hidden',userInvocable:false}),createSkill({id:'manual',name:'Manual',modelInvocable:false})];
 it('accepts deliberate names and commands',()=>{for(const input of ['$release-checklist','/release-checklist do it','请使用 Release Checklist 帮我做上线检查'])expect(resolveExplicitSkills(input,skills).map(skill=>skill.id)).toEqual(['release-checklist']);});
 it('does not guess from overlapping names, keywords or skill body',()=>{for(const input of ['audit的作用是什么','请帮我审计风险','这段Release Checklist描述很好','preaditing'])expect(resolveExplicitSkills(input,skills)).toEqual([]);});
 it('ignores negation, quoted source and code examples',()=>{for(const input of ['不要使用 Release Checklist','不要 $audit','> $audit','```\n$audit\n```'])expect(resolveExplicitSkills(input,skills)).toEqual([]);});
 it('supports explicit manual-only skills and excludes hidden skills',()=>{expect(resolveExplicitSkills('$manual $hidden',skills).map(skill=>skill.id)).toEqual(['manual']);});
 it('does not treat prefixes as exact matches and does not cap explicit choices silently',()=>{expect(resolveExplicitSkills('$audit-log',skills)).toEqual([]);expect(resolveExplicitSkills('$audit $release-checklist $manual',skills)).toHaveLength(3);});
});
