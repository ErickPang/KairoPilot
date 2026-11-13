import path from 'node:path';
import { createHash } from 'node:crypto';
import { pluginPackages, supportedPluginScope } from './packageManager';
import { readSkillRecord } from '../skills/skillIndexUtils';
import type { SkillRecord, PluginRegistryEntry } from '../../../shared/contracts';

/** Package-owned skills are indexed in place, never copied to the standalone skill store. */
export async function listPluginSkills(owner?: string): Promise<SkillRecord[]> {
  const result: SkillRecord[] = [];
  let plugins: PluginRegistryEntry[];
  try { plugins = await pluginPackages.installed(); } catch { return result; }
  for (const plugin of plugins) {
    if (plugin.packageVersion !== 1 || plugin.enabled === false || !supportedPluginScope(plugin.scope, owner)) continue;
    try {
      const pack = await pluginPackages.read(plugin);
      for (const root of pack.manifest.skills || []) {
        const id = `plugin-${createHash('sha256').update(JSON.stringify([plugin.id, plugin.scope, root])).digest('hex').slice(0, 16)}-${path.posix.basename(root).slice(0, 32)}`;
        const record = await readSkillRecord(path.join(path.dirname(plugin.filePath), 'resources', root), 'public', id);
        if (record) result.push(record);
      }
    } catch { /* Unavailable packages cannot inject instructions or block standalone skills. */ }
  }
  return result;
}
