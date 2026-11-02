import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ConversationProcess } from './ConversationProcess';
import { ToolActivity } from './ChatMessagesPanel';
import { I18nProvider } from './layout/I18nProvider';
import type { RunSummary } from '../../shared/contracts';
const run: RunSummary = { id: 'r', agentId: 'a', sessionId: 's', goal: 'read', userInput: 'read', status: 'completed', createdAt: 1000, updatedAt: 33000, completedAt: 33000 };
function render(status: RunSummary['status']) {
 return renderToStaticMarkup(<I18nProvider><ConversationProcess run={{ ...run, status }} now={33000} live={status === 'running' || status === 'waiting_approval'}><p>真实中途输出</p></ConversationProcess><p>最终答复</p></I18nProvider>);
}
describe('conversation process', () => {
 it('folds completed process contents while keeping the final answer visible', () => { const html=render('completed'); expect(html).not.toContain('真实中途输出'); expect(html).toContain('最终答复'); expect(html).toContain('用时 32秒'); });
 it('shows live commentary without a pause action or internal step list', () => { const html=render('running');expect(html).toContain('真实中途输出');expect(html).not.toContain('<button');expect(html).not.toContain('模型推理'); });
 it('keeps failed output inspectable and labels cancellation accurately', () => { expect(render('failed')).toContain('真实中途输出'); expect(render('cancelled')).toContain('已停止'); });
 it('matches the running reference heading and concrete search activity', () => {
  const html = renderToStaticMarkup(<I18nProvider><ConversationProcess run={{ ...run, status: 'running' }} now={33000} live><ToolActivity sessionId="s" item={{ id: 't', runId: 'r', sequence: 1, kind: 'tool', content: 'glob', status: 'running', activity: { action: 'files', target: 'components', icon: 'search' } }}/></ConversationProcess></I18nProvider>);
  expect(html).toContain('已处理 32秒');
  expect(html).toContain('正在搜索 components 文件夹中的文件');
  expect(html).toContain('lucide-search');
  expect(html).not.toContain('lucide-chevron-right');
  expect(html).not.toContain('运行信息');
  expect(html).not.toContain('上下文');
 });
});
