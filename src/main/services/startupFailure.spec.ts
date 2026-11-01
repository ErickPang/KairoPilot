import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const electron = vi.hoisted(() => ({ app: { quit: vi.fn() }, dialog: { showErrorBox: vi.fn() } }));
vi.mock('electron', () => electron);
import { handleStartupFailure } from './startupFailure';
beforeEach(() => { electron.app.quit.mockReset(); electron.dialog.showErrorBox.mockReset(); vi.spyOn(console, 'error').mockImplementation(() => {}); });
afterEach(() => vi.restoreAllMocks());
it('reports a redacted initialization failure and exits instead of retaining an invisible locked instance', () => {
  handleStartupFailure(new Error('Migration failed; token=synthetic-private-value'));
  expect(electron.dialog.showErrorBox).toHaveBeenCalled();
  expect(electron.dialog.showErrorBox.mock.calls[0][1]).not.toContain('synthetic-private-value');
  expect(electron.app.quit).toHaveBeenCalledOnce();
});
it('still exits if the operating system cannot display the startup error dialog', () => {
  electron.dialog.showErrorBox.mockImplementation(() => { throw new Error('Dialog unavailable'); });
  expect(() => handleStartupFailure(new Error('Migration failed'))).toThrow('Dialog unavailable');
  expect(electron.app.quit).toHaveBeenCalledOnce();
});
