import type { TranslationKey } from './en';

const zh: Record<TranslationKey, string> = {
  // Common
  'common.save': '保存',
  'common.cancel': '取消',
  'common.delete': '删除',
  'common.edit': '编辑',
  'common.add': '添加',
  'common.confirm': '确认',
  'common.loading': '加载中...',
  'common.success': '成功',
  'common.error': '错误',

  // Navigation
  'nav.chat': '聊天',
  'nav.skills': '技能',
  'nav.auditLogs': '审计日志',
  'nav.settings': '设置',

  // Settings Sidebar
  'settings.title': '设置',
  'settings.models': '模型配置',
  'settings.agents': 'Agent 配置',
  'settings.general': '通用设置',

  // General Settings
  'general.language': '语言',
  'general.language.zh': '中文',
  'general.language.en': 'English',

  // Chat
  'chat.placeholder': '输入您的消息...',
  'chat.send': '发送',

  // Skills
  'skills.installed': '已安装插件',
  'skills.marketplace': '插件商店',
  'skills.install': '安装',
  'skills.uninstall': '卸载',
  
  // Agents
  'agent.defaultName': '主 Agent',
};

export default zh;
