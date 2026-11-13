import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { FileBrowser } from '../src/renderer/components/FileBrowser';
import { FilePreview } from '../src/renderer/components/FilePreview';
import { OllamaManager } from '../src/renderer/components/config/OllamaManager';
import { KAIRO_INVOKE as C } from '../src/shared/ipc';

// Real React components, synthetic IPC only. Responses are deliberately resolved out of order.
const pending = new Map<string, Array<{ resolve: (value: unknown) => void; reject: (error: Error) => void }>>();
const timers = new Map<number, () => void>();
let timerId = 1000000;
const nativeTimeout = window.setTimeout.bind(window);
const nativeClearTimeout = window.clearTimeout.bind(window);
window.setTimeout = ((callback: TimerHandler, delay?: number, ...args: unknown[]) => {
  if (delay !== 5000) return nativeTimeout(callback, delay, ...args);
  const id = ++timerId;
  timers.set(id, () => { if (typeof callback === 'function') callback(...args); });
  return id;
}) as typeof window.setTimeout;
window.clearTimeout = (id?: number) => { timers.delete(id!); nativeClearTimeout(id); };
const fixture = {
  count: (key: string) => pending.get(key)?.length || 0,
  settle(key: string, value: unknown, error?: string) {
    const request = pending.get(key)?.shift();
    if (!request) throw new Error(`No pending request: ${key}`);
    if (error) request.reject(new Error(error)); else request.resolve(value);
  },
  timerCount: () => timers.size,
  fireTimers() { const callbacks = [...timers.values()]; timers.clear(); callbacks.forEach(callback => callback()); }
};
Object.assign(window, { fileFixture: fixture });
window.kairo = {
  invoke: async (channel: string, input: unknown) => {
    if (channel === C.ollamaCheck) return { running: true };
    const key = channel === C.ollamaPull ? 'pull' : String(input);
    return new Promise((resolve, reject) => {
      const requests = pending.get(key) || []; requests.push({ resolve, reject }); pending.set(key, requests);
    });
  },
  on: () => () => {}
} as unknown as KairoBridge;

export function Fixture() {
  const [root, setRoot] = useState('/root-a');
  const [preview, setPreview] = useState('/preview-a');
  const [show, setShow] = useState(true);
  return <>
    <button id="root-b" onClick={() => setRoot('/root-b')}>Switch root</button>
    <button id="root-c" onClick={() => setRoot('/root-c')}>Fail root</button>
    <button id="preview-b" onClick={() => setPreview('/preview-b')}>Switch preview</button>
    <button id="preview-c" onClick={() => setPreview('/preview-c')}>Fail preview</button>
    <button id="unmount" onClick={() => setShow(false)}>Unmount</button>
    {show && <>
      <FileBrowser rootPath={root}/>
      <FilePreview filePath={preview} isExpanded={false} onToggleExpand={() => {}}/>
      <OllamaManager editingModel={{ id: 'fixture', name: 'fixture', provider: 'ollama', baseUrl: 'http://synthetic.invalid/v1', apiKey: '', model: 'fixture' }} onClearNotice={() => {}} onReportNotice={() => {}} onFetchModels={async () => ({ success: true, models: [] })}/>
    </>}
  </>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);
