import { describe, expect, it } from 'vitest';
import type { SkillSummary } from '../../shared/contracts';
import { completeSkill, filterSkillChoices, invocableSkillChoices, skillDescriptionPreview, skillInput, slashSkillQuery, splitSkillInput } from './skillCompletion';
import { resolveExplicitSkills } from '../../main/core/skills/resolver';

const skill = (id: string, patch: Partial<SkillSummary> = {}): SkillSummary => ({ id, name: id, description: '整理资料', whenToUse: '', arguments: [], userInvocable: true, modelInvocable: true, allowedTools: [], executionMode: 'inline', content: 'body', source: 'public', skillDir: '/skills', skillFilePath: '/skills/SKILL.md', ...patch });

describe('slash skill completion', () => {
  it('shows a short original description while matching the full skill metadata', () => {
    const choice = skill('audit', { description: '检查文档。\n发现问题后给出修复建议。' });
    expect(skillDescriptionPreview(choice)).toBe('检查文档。');
    expect(choice.description).toContain('修复建议');
    expect(filterSkillChoices([choice], '修复建议')).toEqual([choice]);
    expect(skillDescriptionPreview(skill('fallback', { description: ' ', whenToUse: '  Find documents. Use when searching. ' }))).toBe('Find documents.');
    expect(skillDescriptionPreview(skill('long', { description: '😀'.repeat(80) }))).toBe('😀'.repeat(72) + '…');
    expect(skillDescriptionPreview(skill('empty', { description: '' }))).toBe('');
  });
  it('detects only the current line command, without intercepting URLs, paths or selections', () => {
    expect(slashSkillQuery('/', 1)).toEqual({ start: 0, end: 1, text: '' });
    expect(slashSkillQuery('说明\n  /au 后续要求', 8)).toEqual({ start: 5, end: 8, text: 'au' });
    for (const text of ['https://example.com', '/Users/project', '请看 /audit', '> /audit', '/audit 完整要求']) expect(slashSkillQuery(text, text.length)).toBeNull();
    expect(slashSkillQuery('/Users/project', 6)).toBeNull();
    expect(slashSkillQuery('/', -1)).toBeNull();
  });
  it('uses runtime scope precedence and includes manual-only skills while excluding hidden ones', () => {
    const choices = invocableSkillChoices({ public: [skill('audit'), skill('manual', { modelInvocable: false }), skill('hidden', { userInvocable: false })], workbench: [skill('audit', { description: '项目审计' })] });
    expect(choices.map(item => item.id)).toEqual(['audit', 'manual']);
    expect(choices[0].description).toBe('项目审计');
    expect(choices[0]).not.toHaveProperty('content');
    expect(invocableSkillChoices({ public: [skill('audit')], workbench: [skill('audit', { userInvocable: false })] })).toEqual([]);
  });
  it('matches Chinese descriptions and names case-insensitively, prioritizing exact and prefix matches', () => {
    const choices = [skill('other', { name: 'Other', description: 'Audit documents' }), skill('audit-trail'), skill('audit')];
    expect(filterSkillChoices(choices, 'AUDIT').map(item => item.id)).toEqual(['audit', 'audit-trail', 'other']);
    expect(filterSkillChoices(choices, '资料').map(item => item.id)).toEqual(['audit', 'audit-trail']);
    expect(filterSkillChoices(choices, 'missing')).toEqual([]);
  });
  it('replaces the whole partial token while preserving surrounding text and produces an explicit invocation', () => {
    const input = '说明\n/auxt 保留要求';
    const query = slashSkillQuery(input, 6)!;
    const completed = completeSkill(input, query, skill('audit'));
    expect(completed).toEqual({ input: '/audit 说明\n保留要求', caret: 3 });
    expect(resolveExplicitSkills(completed.input, [skill('audit')]).map(item => item.id)).toEqual(['audit']);
    expect(completeSkill('/', slashSkillQuery('/', 1)!, skill('manual')).input).toBe('/manual ');
  });
  it('restores known skill tokens from a draft without treating paths or incomplete commands as tokens', () => {
    const choices = [skill('audit'), skill('manual')];
    const input = '/audit\n/manual  保留正文\n后续要求';
    const split = splitSkillInput(input, choices);
    expect(split.selected.map(item => item.id)).toEqual(['audit', 'manual']);
    expect(split.text).toBe(' 保留正文\n后续要求');
    expect(split.prefix + split.text).toBe(input);
    for (const text of ['/audit', '/unknown test', '/Users/project/file', '> /audit test', '正文\n/audit test']) {
      expect(splitSkillInput(text, choices)).toEqual({ selected: [], prefix: '', text });
    }
    expect(splitSkillInput('/audit text', [])).toEqual({ selected: [], prefix: '', text: '/audit text' });
  });
  it('keeps multiple selections explicitly invocable and preserves the body when removing tokens', () => {
    const choices = [skill('audit'), skill('manual')];
    const text = '/man 保留要求';
    const completed = completeSkill(text, slashSkillQuery(text, 4)!, choices[1], [choices[0]]);
    expect(completed.input).toBe('/audit\n/manual 保留要求');
    expect(resolveExplicitSkills(completed.input, choices).map(item => item.id)).toEqual(['audit', 'manual']);
    const split = splitSkillInput(completed.input, choices);
    expect(skillInput(split.selected.slice(1), split.text)).toBe('/manual 保留要求');
    expect(skillInput([], split.text)).toBe('保留要求');
    expect(completeSkill('/', slashSkillQuery('/', 1)!, choices[0], [choices[0]]).input).toBe('/audit ');
  });
});
