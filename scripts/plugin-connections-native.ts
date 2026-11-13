import { BrowserWindow } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

export async function verifyPluginConnections(output: string, assert: (ok: unknown, label: string) => void) {
  const window = new BrowserWindow({ width: 1000, height: 900, show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
  const js = (source: string) => window.webContents.executeJavaScript(source);
  const wait = (condition: string) => js(`new Promise(resolve => {
    const deadline = Date.now() + 5000;
    const timer = setInterval(() => {
      if (${condition}) { clearInterval(timer); resolve(true); }
      else if (Date.now() > deadline) { clearInterval(timer); resolve(false); }
    }, 20);
  })`);
  const remote = '[data-connection-id="remote"]';
  try {
    await window.loadFile(path.join(output, 'plugin-connections.html'));
    assert(await wait(`document.querySelector('${remote}')`), 'plugin connection panel mounts');
    assert(await js(`!document.documentElement.dataset.connectCalls && !document.documentElement.dataset.approveCalls`), 'browsing plugin details never connects or approves tools');
    assert(await js(`document.querySelector('[data-connection-id="restricted"] button').disabled`), 'unavailable restricted mode cannot silently start a trusted process');
    await js(`document.querySelector('${remote} button').click()`);
    assert(await wait(`document.documentElement.dataset.confirmCount === '1' && !document.querySelector('${remote} button').disabled`), 'connecting requires an explicit decision');
    assert(await js(`!document.documentElement.dataset.connectCalls && document.documentElement.dataset.confirmMessage.includes('https://mcp.example.invalid/mcp') && document.documentElement.dataset.confirmMessage.includes('Synthetic task')`), 'rejected connection sends no IPC and shows endpoint and task');
    await js(`{
      const input = document.querySelector('input[type="password"]');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'synthetic-session-token');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      document.documentElement.dataset.confirmOutcome = 'allow';
    }`);
    await js(`document.querySelector('${remote} button').click()`);
    assert(await wait(`document.querySelector('${remote} .btn-primary')`), 'connected tools still require catalog review');
    assert(await js(`{
      const payload = JSON.parse(document.documentElement.dataset.lastPayload);
      payload.sessionId === 'task-fixture' && payload.expectedHash === 'reviewed-package' && payload.token === 'synthetic-session-token' && !document.documentElement.dataset.approveCalls && document.querySelector('input[type="password"]').value === '';
    }`), 'connection pins task and package and clears the credential input');
    await js(`document.querySelector('${remote} details').open = true`);
    assert(await js(`document.querySelector('${remote} pre').textContent.includes('required')`), 'live input schema is available for review');
    await js(`document.querySelector('${remote} .btn-primary').click()`);
    assert(await wait(`document.documentElement.dataset.approveCalls === '1' && !document.querySelector('${remote} .btn-primary')`), 'catalog approval is a separate action');
    assert(await js(`JSON.parse(document.documentElement.dataset.lastPayload).catalogHash === 'reviewed-catalog' && !JSON.parse(document.documentElement.dataset.lastPayload).token && document.documentElement.dataset.confirmMessage.includes('echo')`), 'catalog approval pins the reviewed hash without resending credentials');
    await js(`document.querySelectorAll('${remote} button')[1].click()`);
    assert(await wait(`!document.querySelector('${remote} details') && document.querySelectorAll('${remote} button').length === 1`), 'disconnect removes the tools from the UI');
    assert(await js(`![...Object.values(localStorage), ...Object.values(sessionStorage)].some(value => value.includes('synthetic-session-token'))`), 'connection UI never persists a token in browser storage');
    fs.writeFileSync(path.join(output, 'plugin-connections.png'), (await window.webContents.capturePage()).toPNG());
  } finally { window.destroy(); }
}
