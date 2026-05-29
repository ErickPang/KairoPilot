import { describe, expect, it } from 'vitest';
import { DEFAULT_SHELL_COMMANDS, PRIVILEGED_SHELL_COMMANDS } from './contracts';

describe('shell command presets', () => {
  it('keeps privileged commands out of the recommended default command list', () => {
    expect(DEFAULT_SHELL_COMMANDS).not.toContain('rm');
    expect(DEFAULT_SHELL_COMMANDS).not.toContain('open');
    expect(DEFAULT_SHELL_COMMANDS).not.toContain('curl');
    expect(PRIVILEGED_SHELL_COMMANDS).toEqual(['rm', 'open', 'curl']);
  });
});
