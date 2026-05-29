import type { AppearanceTheme } from './types';

const APPEARANCE_THEME_CHANGED = 'kairopilot:appearance-theme-changed';

type ResolvedTheme = 'light' | 'dark' | 'slate' | 'warm';

function getSystemTheme(): ResolvedTheme {
  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return 'light';
}

export function resolveTheme(theme: AppearanceTheme): ResolvedTheme {
  return theme === 'system' ? getSystemTheme() : theme;
}

export function applyAppearanceTheme(theme: AppearanceTheme) {
  const resolvedTheme = resolveTheme(theme);
  document.documentElement.dataset.theme = resolvedTheme;
  document.documentElement.dataset.themePreference = theme;
  document.documentElement.style.colorScheme = resolvedTheme;
}

export function emitAppearanceThemeChanged(theme: AppearanceTheme) {
  window.dispatchEvent(new CustomEvent<AppearanceTheme>(APPEARANCE_THEME_CHANGED, { detail: theme }));
}

export function subscribeAppearanceThemeChanged(listener: (theme: AppearanceTheme) => void) {
  const handleThemeChanged = (event: Event) => {
    const customEvent = event as CustomEvent<AppearanceTheme>;
    listener(customEvent.detail);
  };

  window.addEventListener(APPEARANCE_THEME_CHANGED, handleThemeChanged);
  return () => {
    window.removeEventListener(APPEARANCE_THEME_CHANGED, handleThemeChanged);
  };
}

export function subscribeSystemThemeChanged(listener: () => void) {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return () => {};
  }

  const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
  const handleChange = () => listener();
  mediaQuery.addEventListener('change', handleChange);

  return () => {
    mediaQuery.removeEventListener('change', handleChange);
  };
}
