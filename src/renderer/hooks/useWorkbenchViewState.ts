import { useCallback, useEffect, useRef, useState } from 'react';
import type { TaskViewState } from '../components/taskViewState';

const TASK_VIEWS_KEY = 'kairo.workbench.taskViews.v2';

function readJson(key: string): unknown {
  try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch { return null; }
}

function validView(value: unknown): TaskViewState {
  if (!value || typeof value !== 'object') return {};
  const view = value as TaskViewState;
  return {
    scrollTop: typeof view.scrollTop === 'number' && Number.isFinite(view.scrollTop) ? Math.max(0, view.scrollTop) : undefined,
    previewFilePath: typeof view.previewFilePath === 'string' ? view.previewFilePath : undefined,
    directoryPath: typeof view.directoryPath === 'string' ? view.directoryPath : undefined,
    auxiliaryPanel: view.auxiliaryPanel && ['files', 'results', 'details'].includes(view.auxiliaryPanel) ? view.auxiliaryPanel : null
  };
}

class TaskViewCache extends Map<string, TaskViewState> {
  private timer: number | undefined;
  constructor() {
    super();
    const stored = readJson(TASK_VIEWS_KEY);
    if (stored && typeof stored === 'object' && !Array.isArray(stored)) {
      for (const [key,value] of Object.entries(stored).slice(-100)) {
        if(key.startsWith('workbench:'))super.set(key,validView(value));
      }
    }
  }
  flush = () => {
    window.clearTimeout(this.timer);
    try { localStorage.setItem(TASK_VIEWS_KEY, JSON.stringify(Object.fromEntries([...this].slice(-100).map(([key, value]) => [key, validView(value)])))); } catch { /* UI preferences are best effort; drafts use SQLite. */ }
  };
  set(key: string, value: TaskViewState) {
    super.delete(key);
    super.set(key, value);
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(this.flush, 250);
    return this;
  }
}

export function useWorkbenchViewState(taskKey: string) {
  const cache = useRef<TaskViewCache>();
  if (!cache.current) cache.current = new TaskViewCache();
  const taskViews = cache as React.MutableRefObject<TaskViewCache>;
  const [, render] = useState(0);
  const updateView = useCallback((patch: Partial<TaskViewState>) => {
    taskViews.current.set(taskKey, { ...taskViews.current.get(taskKey), ...patch });
    render((value) => value + 1);
  }, [taskKey, taskViews]);
  useEffect(() => {
    const flush = taskViews.current.flush;
    window.addEventListener('pagehide', flush);
    return () => { window.removeEventListener('pagehide', flush); flush(); };
  }, [taskViews]);
  return { taskViews, view: taskViews.current.get(taskKey) || {}, updateView };
}

export function useWorkbenchPreference<T>(key: string, initial: T, validate: (value: unknown) => value is T) {
  const [value, setValue] = useState<T>(() => {
    const stored=readJson(key);
    return validate(stored) ? stored : initial;
  });
  useEffect(() => { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* Nonessential preference. */ } }, [key, value]);
  return [value, setValue] as const;
}
