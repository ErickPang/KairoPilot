import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import type { PluginRegistryEntry } from '../../../shared/contracts';
const state = vi.hoisted(() => ({ root: '', registry: [] as PluginRegistryEntry[], failSave: false }));
vi.mock('electron', () => ({ app: { getPath: () => state.root } }));
vi.mock('../../store/config', () => ({ getPluginRegistry: () => structuredClone(state.registry), savePluginRegistry: (value: PluginRegistryEntry[]) => { if (state.failSave) throw new Error('Persistence failed'); state.registry = structuredClone(value); } }));
import { PluginManager } from './manager';
import { PluginPackageManager } from './packageManager';
import { parsePluginPackage } from './packageManifest';
import { listPluginSkills } from './pluginSkills';
import { PermissionGuard } from '../security/permissions';

function pack(version = '1') { return parsePluginPackage({ manifest: { packageVersion: 1, id: 'example.docs', name: 'Docs', version, author: 'Fixture', description: 'Documents', skills: ['skills/research'], connections: [] }, files: { 'skills/research/SKILL.md': '---\nname: research\ndescription: Research fixture\n---\nUse approved tools only.' } }); }
beforeEach(async () => { state.root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'kairo-plugin-package-'))); state.registry = []; state.failSave = false; });
afterEach(async () => { await fs.rm(state.root, { recursive: true, force: true }); vi.unstubAllGlobals(); });
async function install(manager: PluginPackageManager, version = '1', operation: 'install' | 'update' = 'install') { const review = manager.prepare(pack(version), 'public', operation, { type: 'local' }); await manager.install(review.requestId); return review; }

describe('declarative plugin packages', () => {
  it('reviews and installs resources without evaluating executable text', async () => {
    const manager = new PluginPackageManager(); const value = pack(); value.files['payload.js'] = 'throw new Error("must never execute")';
    const review = manager.prepare(value, 'public', 'install', { type: 'local' }); expect(state.registry).toEqual([]);
    expect(review.summary).toContain('不会启动'); await manager.install(review.requestId);
    expect((await manager.installed())[0].runtimeStatus).toBe('ready'); expect((await manager.read(state.registry[0])).files['payload.js']).toContain('must never execute');
    await expect(manager.install(review.requestId)).rejects.toThrow('expired');
  });
  it.each(['../outside', '/tmp/outside', 'a/b', '..\\outside', '..'])('rejects unsafe package id %s', id => { const value = pack(); value.manifest.id = id; expect(() => parsePluginPackage(value)).toThrow(); });
  it.each(['../secret', '/secret', 'a/../secret', 'a\\secret', 'C:/secret'])('rejects unsafe resource path %s', name => { const value = pack(); value.files[name] = 'text'; expect(() => parsePluginPackage(value)).toThrow(); });
  it('rejects resources that collide on case-insensitive file systems or as parent files', () => {
    for (const names of [['A.md', 'a.md'], ['folder', 'folder/file.md'], ['trailing./x', 'normal']]) {
      const value = pack(); for (const name of names) value.files[name] = 'text';
      expect(() => parsePluginPackage(value)).toThrow();
    }
  });
  it('retains legacy records but refuses enabling or loading their code', async () => {
    const file = path.join(state.root, 'legacy.js'); await fs.writeFile(file, 'throw new Error("escaped")');
    state.registry = [{ id: 'legacy', name: 'Legacy', description: '', version: '1', author: 'Fixture', filePath: file, installedAt: 1, scope: 'public', tools: [], capabilities: [], riskLevel: 'low' }];
    const manager = new PluginManager(); expect((await manager.getInstalledPlugins())[0].runtimeStatus).toBe('legacy_blocked');
    await expect(manager.setPluginEnabled('legacy', 'public', true)).rejects.toThrow('Legacy');
    await expect(manager.loadPluginTools({ pluginId: 'legacy', scope: 'public' }, 'workbench', {} as PermissionGuard, 'task')).rejects.toThrow('conversion');
    expect(state.registry).toHaveLength(1); expect(await fs.readFile(file, 'utf8')).toContain('escaped');
  });
  it('detects modified resources and redirected resource symlinks', async () => {
    const manager = new PluginPackageManager(); await install(manager); const item = state.registry[0];
    const resource = path.join(path.dirname(item.filePath), 'resources/skills/research/SKILL.md');
    await fs.writeFile(resource, 'changed'); await expect(manager.read(item)).rejects.toThrow('integrity');
    const redirected = path.join(state.root, 'redirected.md'); await fs.writeFile(redirected, pack().files['skills/research/SKILL.md']);
    await fs.unlink(resource); await fs.symlink(redirected, resource); await expect(manager.read(item)).rejects.toThrow('integrity');
  });
  it('commits updates and rollback by switching immutable revisions', async () => {
    const manager = new PluginPackageManager(); await install(manager); const old = state.registry[0].filePath;
    await install(manager, '2', 'update'); expect(state.registry[0].filePath).not.toBe(old); expect(await fs.readFile(old, 'utf8')).toContain('"version":"1"');
    await manager.rollback('example.docs', 'public'); expect(state.registry[0].filePath).toBe(old); expect(state.registry[0].version).toBe('1');
  });
  it('reviews a second local import as an update with a rollback snapshot', async () => {
    const manager = new PluginPackageManager(); await install(manager);
    const source = path.join(state.root, 'update.json'); await fs.writeFile(source, JSON.stringify(pack('2')));
    const review = await manager.prepareImport(source, 'public'); expect(review.operation).toBe('update'); expect(review.versionDiff?.fromVersion).toBe('1');
    await manager.install(review.requestId); expect(state.registry[0].version).toBe('2');
    await manager.rollback('example.docs', 'public'); expect(state.registry[0].version).toBe('1');
  });
  it('does not echo invalid local file contents through import errors', async () => {
    const source = path.join(state.root, 'invalid.json'); await fs.writeFile(source, 'synthetic-private-content');
    await expect(new PluginPackageManager().prepareImport(source, 'public')).rejects.toThrow(/^Invalid declarative plugin package\./);
  });
  it('leaves the current revision intact when persistence fails', async () => {
    const manager = new PluginPackageManager(); await install(manager); const before = structuredClone(state.registry);
    const review = manager.prepare(pack('2'), 'public', 'update', { type: 'local' }); state.failSave = true;
    await expect(manager.install(review.requestId)).rejects.toThrow('Persistence'); expect(state.registry).toEqual(before); expect((await manager.read(state.registry[0])).manifest.version).toBe('1');
  });
  it('rejects a stale review after another update', async () => {
    const manager = new PluginPackageManager(); await install(manager);
    const stale = manager.prepare(pack('2'), 'public', 'update', { type: 'local' }); await install(manager, '3', 'update');
    await expect(manager.install(stale.requestId)).rejects.toThrow('changed after review');
  });
  it('indexes package-owned skills without copying or deleting standalone skills', async () => {
    const manager = new PluginPackageManager(); await install(manager);
    const skills = await listPluginSkills('workbench'); expect(skills).toHaveLength(1); expect(skills[0].id).toMatch(/^plugin-/); expect(skills[0].content).toContain('approved tools');
    const stored = state.registry[0].filePath;
    await manager.enable('example.docs', 'public', false); expect(await listPluginSkills('workbench')).toEqual([]);
    await manager.uninstall('example.docs', 'public'); expect(await fs.readFile(stored, 'utf8')).toContain('research');
  });
});
