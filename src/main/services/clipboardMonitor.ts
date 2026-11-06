import { clipboard, BrowserWindow } from 'electron';

type ClipboardHint = {
  text: string;
  kind: 'code' | 'error' | 'url';
  length: number;
};

const CODE_INDICATORS = [
  /^(import|export|const|let|var|function|class|interface|type|enum)\s/m,
  /^(def|class|import|from|async|await)\s/m,
  /^[#!/]/,  // shebang or comment-only
  /^<\?php|^<!DOCTYPE|^<html|^<div|^<script|^import\s+React/m,
  /\b(function|return|if|for|while|switch|catch|try)\b.*[{};]/m,
  /```[\s\S]+```/m,
  /^\s*[{[]/m,  // starts with JSON-like structure
];

const ERROR_INDICATORS = [
  /\b(Error|Exception|Traceback|TypeError|ReferenceError|SyntaxError)\b/i,
  /\bat\s+\S+:\d+:\d+/m,  // stack trace lines
  /\b(crashed|failed|timeout|refused|denied|unauthorized|not found)\b/i,
  /^\s*(Error|ERR_|FATAL|PANIC)\b/m,
  /\b\d{3}\s+(Internal Server Error|Bad Request|Not Found|Forbidden)/,
];

const URL_INDICATORS = [
  /^https?:\/\/\S+$/,
];

const MIN_TEXT_LENGTH = 10;
const MAX_TEXT_LENGTH = 50000;

function detectClipboardKind(text: string): ClipboardHint['kind'] | null {
  const trimmed = text.trim();
  if (trimmed.length < MIN_TEXT_LENGTH || trimmed.length > MAX_TEXT_LENGTH) return null;

  for (const pattern of ERROR_INDICATORS) {
    if (pattern.test(trimmed)) return 'error';
  }
  for (const pattern of URL_INDICATORS) {
    if (pattern.test(trimmed)) return 'url';
  }
  for (const pattern of CODE_INDICATORS) {
    if (pattern.test(trimmed)) return 'code';
  }
  return null;
}

export function startClipboardMonitor(getMainWindow: () => BrowserWindow | null, isEnabled: () => boolean) {
  let lastText = '';
  let disposed = false;
  let polling = false;
  // Polling interval – Electron doesn't expose a clipboard change event directly
  const interval = setInterval(async () => {
    const win = getMainWindow();
    if (disposed || polling || !win || !win.isVisible() || win.isMinimized() || !win.isFocused()) return;
    polling = true;

    try {
      if (!isEnabled()) { lastText = ''; return; }
      const text = await clipboard.readText();
      if (disposed || !isEnabled() || !win.isFocused()) return;
      if (!text || text === lastText) return;

      lastText = text;
      const kind = detectClipboardKind(text);
      if (!kind) return;

      const preview = text.length > 200 ? text.slice(0, 200) + '...' : text;
      win.webContents.send('kairo:clipboard-hint', {
        kind,
        preview,
        length: text.length,
      });
    } catch {
      // Clipboard read may fail on some platforms
    } finally {
      polling = false;
    }
  }, 1500); // Poll every 1.5s

  return () => { disposed = true; clearInterval(interval); };
}
