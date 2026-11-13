import { BrowserWindow } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

export async function verifyModelConfiguration(output: string, assert: (ok: unknown, label: string) => void) {
  const window = new BrowserWindow({ width: 1100, height: 900, show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
  const js = (source: string) => window.webContents.executeJavaScript(source);
  const wait = (condition: string) => js(`new Promise(resolve => {
    const deadline = Date.now() + 10000;
    const timer = setInterval(() => {
      if (${condition}) { clearInterval(timer); resolve(true); }
      else if (Date.now() > deadline) { clearInterval(timer); resolve(false); }
    }, 20);
  })`);
  const fill = (selector: string, value: string) => js(`{
    const input = document.querySelector(${JSON.stringify(selector)});
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(value)});
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }`);
  try {
    await window.loadFile(path.join(output, 'model-config.html'));
    assert(await wait(`document.querySelector('.config-page-header-action')`), 'model configuration fixture mounts');
    await js(`document.querySelector('.config-page-header-action').click()`);
    assert(await wait(`document.querySelector('.config-back-button')`), 'new model editor opens');
    assert(await js(`!!document.querySelector('.editor-inline-row-top input')`), 'manual model ID is available before fetching');
    // The model input is the only input in the manual-add row.
    const manual = '.editor-inline-row-top input';
    await fill('.config-content input', 'release-fixture');
    await fill('input[type="password"]', 'synthetic-key');
    await fill('.config-content .config-detail-section:nth-child(2) input', 'http://127.0.0.1:1/v1');
    await js(`document.querySelector('.editor-inline-row > .btn-secondary').click()`);
    assert(await wait(`document.querySelector('[role="alert"]').textContent.includes('1')`), 'model listing succeeds in fixture');
    assert(await js(`!!document.querySelector('${manual}')`), 'manual ID remains available after a successful model listing');
    await fill(manual, 'manual-only-model');
    await js(`document.querySelector('.editor-inline-row-top button').click()`);
    assert(await wait(`document.querySelector('.model-editor-select-value').textContent.includes('manual-only-model')`), 'manual ID missing from listing can be selected');

    const endpoint = '.config-content .config-detail-section:nth-child(2) input';
    await fill(endpoint, 'http://slow-fixture.invalid/v1');
    await js(`document.querySelector('.editor-inline-row > .btn-secondary').click()`);
    await fill(endpoint, 'http://fast-fixture.invalid/v1');
    await js(`document.querySelector('.editor-inline-row > .btn-secondary').click()`);
    await new Promise(resolve => setTimeout(resolve, 400));
    await js(`document.querySelector('.model-editor-select-trigger').click()`);
    assert(await wait(`document.querySelector('.model-editor-select-options')?.textContent.includes('fast-model') && !document.querySelector('.model-editor-select-options')?.textContent.includes('slow-model')`), 'late model responses cannot overwrite the current endpoint list');
    await js(`document.querySelector('.model-editor-select-trigger').click()`);
    await fill(endpoint, 'http://127.0.0.1:1/v1');
    await js(`document.querySelector('.model-editor-select-trigger').click()`);
    assert(await wait(`!document.querySelector('.model-editor-select-options')?.textContent.includes('fast-model')`), 'changing endpoints clears fetched models while retaining explicit selections');
    await js(`document.querySelector('.model-editor-select-trigger').click()`);

    await js(`document.querySelector('.config-detail-footer .btn-primary').click()`);
    assert(await wait(`document.documentElement.dataset.saveCalls === '1' && document.querySelector('fieldset:disabled')`), 'save waits for persistence and locks the form');
    await js(`document.querySelector('.config-detail-footer .btn-primary').click()`);
    assert(await js(`document.documentElement.dataset.saveCalls === '1' && document.querySelector('.config-detail-footer .btn-primary').disabled && document.querySelector('.config-back-button').disabled`), 'pending save cannot be submitted twice or cancelled');
    await js(`document.documentElement.dataset.releaseSave = 'yes'`);
    assert(await wait(`document.querySelector('[role="alert"]').textContent.includes('Synthetic secure storage failure') && !document.querySelector('fieldset').disabled`), 'failed save reports the error and unlocks the editor');
    assert(await js(`document.querySelector('.config-content input').value === 'release-fixture' && document.querySelector('input[type="password"]').value === 'synthetic-key' && document.querySelector('.model-editor-select-value').textContent.includes('manual-only-model')`), 'failed save preserves name, credential and manual model ID');
    await js(`document.documentElement.dataset.saveOutcome = 'success'; document.querySelector('.config-detail-footer .btn-primary').click()`);
    assert(await wait(`document.documentElement.dataset.refreshed === 'yes' && !document.querySelector('.config-back-button')`), 'successful retry refreshes configuration before leaving the editor');

    await js(`document.querySelector('.config-page-header-action').click()`);
    assert(await wait(`document.querySelector('.config-back-button')`), 'model editor reopens for provider selection');
    await js(`document.querySelector('[role="combobox"]').click()`);
    assert(await wait(`document.querySelector('[data-option-value="anthropic"]')`), 'provider options open');
    assert(await js(`document.querySelector('[data-option-value="anthropic"]').getAttribute('aria-disabled') === 'true' && document.querySelector('[data-option-value="anthropic"]').textContent.includes('暂不支持')`), 'Anthropic is labelled unsupported and disabled');
    await js(`document.querySelector('[data-option-value="anthropic"]').click()`);
    assert(await js(`document.querySelector('[role="combobox"]').textContent.includes('OpenAI')`), 'clicking unsupported Anthropic does not select it');
    fs.writeFileSync(path.join(output, 'model-config.png'), (await window.webContents.capturePage()).toPNG());
  } finally {
    window.destroy();
  }
}
