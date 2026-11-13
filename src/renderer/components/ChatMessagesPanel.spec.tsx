import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ConversationProcess } from './ConversationProcess';
import { ChatMessagesPanel, ToolActivity } from './ChatMessagesPanel';
import { useTranslation } from '../hooks/useTranslation';
import { I18nProvider } from './layout/I18nProvider';
import type { RunSummary, SkillMention } from '../../shared/contracts';
import type { ComponentProps } from 'react';
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

function StreamingMessage({ status, content, role = 'draft', skillMentions }: { status: string; content: string; role?: 'draft' | 'user'; skillMentions?: SkillMention[] }) {
 const { t } = useTranslation();
 const feed: ComponentProps<typeof ChatMessagesPanel>['feed'] = { before: undefined, isHistory: false, navigationTarget: undefined, finishNavigation: ()=>{}, jumpTo: ()=>{}, earlier: ()=>{}, recent: ()=>{}, error: '', refresh: ()=>{}, data: { rounds: [{ run: { ...run, status: 'running' }, items: [{ id: 'text', runId: run.id, sequence: 1, kind: role, content, status, skillMentions }] }] } };
 return <ChatMessagesPanel sessionId="s" run={{ ...run, status: 'running' }} feed={feed} containerRef={{ current: null }} messagesEndRef={{ current: null }} onViewReference={()=>{}} loading t={t} markdownComponents={{}} toRenderableMarkdown={text=>text||''}/>;
}

describe('sent skill presentation', () => {
 const skill = { id: 'search', name: '发送时的搜索技能' };
 it('renders saved names as non-editable tokens after rename or removal, preserving the body', () => {
  const html = renderToStaticMarkup(<I18nProvider><StreamingMessage status="completed" role="user" content={'/search 今日新闻\n只看官方来源'} skillMentions={[skill]}/></I18nProvider>);
  expect(html).toContain('data-message-skill="search"');
  expect(html).toContain(skill.name);
  expect(html).not.toContain('已更名');
  expect(html).toContain('今日新闻\n只看官方来源');
  expect(html).toContain('composer-skill-token message-skill-token');
  expect(html).not.toContain('data-selected-skill');
  const removed = renderToStaticMarkup(<I18nProvider><StreamingMessage status="completed" role="user" content="/search" skillMentions={[skill]}/></I18nProvider>);
  expect(removed).toContain('data-message-skill="search"');
 });
 it('renders text literally without a sent skill snapshot', () => {
  const render = (content: string) => renderToStaticMarkup(<I18nProvider><StreamingMessage status="completed" role="user" content={content}/></I18nProvider>);
  expect(render('/search 新闻')).not.toContain('data-message-skill');
  for (const content of ['/search/folder', '/unknown 新闻', '正文 /search']) expect(render(content)).not.toContain('data-message-skill');
 });
});

describe('streaming message presentation', () => {
 const renderMessage = (status: string, content: string, role?: 'draft' | 'user') => renderToStaticMarkup(<I18nProvider><StreamingMessage status={status} content={content} role={role}/></I18nProvider>);
 it('keeps headings, lists and code in the same markup before and after streaming finishes', () => {
  const markdown = '## 检查结果\n\n- 保留列表\n\n```ts\nconst answer = 42;\n```';
  const streaming = renderMessage('running', markdown);
  const completed = renderMessage('completed', markdown);
  expect(streaming).toContain('<h2>检查结果</h2>');
  expect(streaming).toContain('<li>保留列表</li>');
  expect(streaming).toContain('<pre><code class="language-ts">const answer = 42;');
  expect(streaming.match(/<div class="markdown-body">(.*?)<\/div>/s)?.[0]).toBe(completed.match(/<div class="markdown-body">(.*?)<\/div>/s)?.[0]);
 });
 it('renders an unfinished code fence without exposing raw HTML or losing its content', () => {
  const html = renderMessage('running', '```html\n<script>alert(1)</script>');
  expect(html).toContain('<pre><code class="language-html">');
  expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  expect(html).not.toContain('<script>');
 });
 it('continues to show user-authored markdown as literal input', () => {
  const html = renderMessage('completed', '## 用户原文', 'user');
  expect(html).toContain('class="message-prewrap">## 用户原文');
  expect(html).not.toContain('<h2>用户原文');
 });
});
