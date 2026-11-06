import { app } from 'electron';
import path from 'path';

export function getConfigPath(): string {
  return path.join(app.getPath('userData'), 'kairopilot.json');
}
