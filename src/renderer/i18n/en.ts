export type TranslationKey = keyof typeof en;

const en = {
  // Common
  'common.save': 'Save',
  'common.cancel': 'Cancel',
  'common.delete': 'Delete',
  'common.edit': 'Edit',
  'common.add': 'Add',
  'common.confirm': 'Confirm',
  'common.loading': 'Loading...',
  'common.success': 'Success',
  'common.error': 'Error',

  // Navigation
  'nav.chat': 'Chat',
  'nav.skills': 'Skills',
  'nav.auditLogs': 'Audit Logs',
  'nav.settings': 'Settings',

  // Settings Sidebar
  'settings.title': 'Settings',
  'settings.models': 'Models',
  'settings.agents': 'Agents',
  'settings.general': 'General',

  // General Settings
  'general.language': 'Language',
  'general.language.zh': '中文',
  'general.language.en': 'English',

  // Chat
  'chat.placeholder': 'Type your message...',
  'chat.send': 'Send',

  // Skills
  'skills.installed': 'Installed',
  'skills.marketplace': 'Marketplace',
  'skills.install': 'Install',
  'skills.uninstall': 'Uninstall',
  
  // Agents
  'agent.defaultName': 'Main Agent',
} as const;

export default en;
