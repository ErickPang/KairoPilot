export function visibleSessionTitle(title: string | undefined, fallback: string): string {
  return !title?.trim() || title === 'New Chat' ? fallback : title;
}
