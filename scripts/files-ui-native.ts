import { BrowserWindow } from 'electron';
import path from 'node:path';

export async function verifyFileUi(output: string, assert: (ok: unknown, label: string) => void) {
  const window = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
  const js = (source: string) => window.webContents.executeJavaScript(source);
  const wait = (condition: string) => js(`new Promise(resolve => {
    const deadline = Date.now() + 5000;
    const timer = setInterval(() => {
      if (${condition}) { clearInterval(timer); resolve(true); }
      else if (Date.now() > deadline) { clearInterval(timer); resolve(false); }
    }, 10);
  })`);
  const check = async (condition: string, label: string) => assert(await wait(condition), label);
  const settle = (key: string, value: unknown, error?: string) => js(`window.fileFixture.settle(${JSON.stringify(key)}, ${JSON.stringify(value)}, ${JSON.stringify(error)})`);
  const fillModel = () => js(`{
    const input = document.querySelector('.ollama-manager input');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'synthetic-model');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }`);
  try {
    await window.loadFile(path.join(output, 'files-ui.html'));
    await check(`window.fileFixture?.count('/root-a') === 1 && window.fileFixture.count('/preview-a') === 1`, 'file components mount with pending synthetic requests');
    await js(`document.querySelector('#root-b').click(); document.querySelector('#preview-b').click()`);
    await check(`window.fileFixture.count('/root-b') === 1 && window.fileFixture.count('/preview-b') === 1`, 'new root and preview requests start');
    await settle('/root-b', { children: [{ name: 'current.txt', path: '/root-b/current.txt', isDirectory: false }] });
    await settle('/preview-b', { kind: 'text', path: '/preview-b', name: 'current.txt', size: 7, extension: 'txt', content: 'CURRENT_PREVIEW' });
    await check(`document.querySelector('.file-browser-tree').textContent.includes('current.txt') && document.querySelector('.file-preview-body').textContent.includes('CURRENT_PREVIEW')`, 'current responses render');
    await settle('/root-a', { children: [{ name: 'STALE_FILE', path: '/root-a/stale', isDirectory: false }] });
    await settle('/preview-a', { kind: 'text', path: '/preview-a', name: 'stale', size: 5, extension: 'txt', content: 'STALE_PREVIEW' });
    // Let both promise continuations and React's render queue settle.
    await js(`new Promise(resolve => setTimeout(resolve, 50))`);
    assert(await js(`!document.body.textContent.includes('STALE_') && document.body.textContent.includes('CURRENT_PREVIEW') && document.body.textContent.includes('current.txt')`), 'late responses cannot overwrite the current directory or preview');
    await js(`document.querySelector('#root-c').click(); document.querySelector('#preview-c').click()`);
    await check(`window.fileFixture.count('/root-c') === 1 && window.fileFixture.count('/preview-c') === 1`, 'error requests start');
    await settle('/root-c', { children: [], error: 'Directory denied' });
    await settle('/preview-c', null, 'Preview rejected');
    await check(`document.querySelector('.file-browser-error')?.textContent === 'Directory denied' && document.querySelector('.file-preview-body').textContent.includes('Preview rejected')`, 'directory errors are visible and rejected preview requests leave loading');

    await fillModel();
    await js(`document.querySelector('.ollama-manager-actions button').click()`);
    await check(`window.fileFixture.count('pull') === 1`, 'first synthetic pull starts');
    await settle('pull', { success: true });
    await check(`window.fileFixture.timerCount() === 1`, 'finished pull schedules progress cleanup');
    await fillModel();
    await js(`document.querySelector('.ollama-manager-actions button').click()`);
    await check(`window.fileFixture.count('pull') === 1 && window.fileFixture.timerCount() === 0`, 'next pull cancels the previous progress timer');
    await js(`window.fileFixture.fireTimers()`);
    assert(await js(`document.querySelector('.ollama-progress').textContent.includes('Starting pull')`), 'old cleanup cannot remove active download progress');
    await settle('pull', { success: true });
    await check(`window.fileFixture.timerCount() === 1`, 'second completion schedules its own cleanup');
    await js(`document.querySelector('#unmount').click()`);
    await check(`window.fileFixture.timerCount() === 0 && !document.querySelector('.ollama-manager')`, 'unmount cancels progress cleanup');
  } finally {
    window.destroy();
  }
}
