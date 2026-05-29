import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const failures = [];

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(path.join(root, filePath), 'utf-8'));
}

function assert(condition, message) {
  if (!condition) {
    failures.push(message);
  }
}

function fileExists(filePath) {
  return fs.existsSync(path.join(root, filePath));
}

const packageJson = readJson('package.json');
const builderConfig = fs.readFileSync(path.join(root, 'electron-builder.json5'), 'utf-8');
const windowService = fs.readFileSync(path.join(root, 'src/main/services/windowService.ts'), 'utf-8');

assert(packageJson.main === 'dist-electron/index.js', 'package.json main must point to dist-electron/index.js');
for (const scriptName of ['typecheck', 'lint', 'test', 'build']) {
  assert(typeof packageJson.scripts?.[scriptName] === 'string', `missing npm script: ${scriptName}`);
}

assert(fileExists('public/icon.png'), 'missing public/icon.png required by electron-builder');
assert(fileExists('skills'), 'missing builtin skills directory required by extraResources');
assert(builderConfig.includes('"asar": true'), 'electron-builder must package app with asar enabled');
assert(builderConfig.includes('"dist"') && builderConfig.includes('"dist-electron"'), 'electron-builder files must include dist and dist-electron');
assert(builderConfig.includes('"dmg"'), 'electron-builder mac target must include dmg');
assert(builderConfig.includes('"nsis"'), 'electron-builder win target must include nsis');
assert(builderConfig.includes('"AppImage"'), 'electron-builder linux target must include AppImage');

assert(windowService.includes('contextIsolation: true'), 'BrowserWindow must enable contextIsolation');
assert(windowService.includes('nodeIntegration: false'), 'BrowserWindow must disable nodeIntegration');
assert(windowService.includes('sandbox: true'), 'BrowserWindow must enable sandbox');
assert(windowService.includes('webSecurity: true'), 'BrowserWindow must enable webSecurity');
assert(windowService.includes('webviewTag: false'), 'BrowserWindow must disable webviewTag');

if (failures.length > 0) {
  console.error('Product smoke checks failed:');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log('Product smoke checks passed.');
