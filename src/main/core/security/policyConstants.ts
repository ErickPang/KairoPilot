export const SENSITIVE_DIRS_BLACKLIST = new Set([
  '.ssh',
  '.gnupg',
  '.aws',
  '.kube',
  'System32',
  'AppData',
  'Library/Application Support',
  'node_modules',
  '.git'
]);

export const PROTECTED_PROMPT_FILES = new Set(['AGENTS.md','AGENTS.override.md','MEMORY.md']);

export const SUPPORTED_SKILL_SCRIPT_EXTENSIONS = ['.js', '.mjs', '.cjs', '.py', '.sh'] as const;
