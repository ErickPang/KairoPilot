import { describe, expect, it } from 'vitest';
import { splitSkillInput } from './skillInvocation';

const skills = [{ id: 'search', name: '联网搜索' }, { id: 'write', name: '写作助手' }];
describe('leading skill invocations', () => {
  it('separates stacked skills and preserves the exact remaining user input', () => {
    expect(splitSkillInput('/search\n/write 今天的新闻\n保留换行', skills)).toEqual({
      selected: skills, prefix: '/search\n/write ', text: '今天的新闻\n保留换行'
    });
    expect(splitSkillInput('/search', skills, true).selected).toEqual([skills[0]]);
    expect(splitSkillInput('/search', skills).selected).toEqual([]);
  });
  it.each(['/unknown 新闻', '/search/folder 文件', '请查看 /search', '`/search`', '```\n/search\n```'])('leaves non-invocations intact: %s', input => {
    expect(splitSkillInput(input, skills)).toEqual({ selected: [], prefix: '', text: input });
  });
});
