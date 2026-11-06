import { app } from 'electron';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function getKairoPilotDataRoot(homePath: string = os.homedir()): string {
  const override = process.env.KAIROPILOT_TEST_ROOT;
  if (!override) return path.join(homePath, '.kairopilot');
  if (app.isPackaged || !path.isAbsolute(override)) {
    throw new Error('KAIROPILOT_TEST_ROOT requires an unpackaged app and an absolute temporary directory.');
  }
  const candidate = path.resolve(override);
  let ancestor = candidate;
  while (!fs.existsSync(ancestor)) ancestor = path.dirname(ancestor);
  const resolved = path.resolve(fs.realpathSync(ancestor), path.relative(ancestor, candidate));
  const temporaryRoot = fs.realpathSync(os.tmpdir());
  const relative = path.relative(temporaryRoot, resolved);
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error('KAIROPILOT_TEST_ROOT must be a subdirectory of the system temporary directory.');
  }
  return resolved;
}
