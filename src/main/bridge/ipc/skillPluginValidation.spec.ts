import { describe, expect, it } from 'vitest';
import { parseIpcInput } from './configValidation';
import {
  PluginActionInputSchema,
  SkillPrepareInstallInputSchema,
  SkillRequestInputSchema,
  SkillsRegistryInputSchema
} from './skillPluginValidation';

describe('skillPluginValidation', () => {
  it('rejects non-HTTPS skill registry sources', () => {
    expect(() => parseIpcInput(SkillsRegistryInputSchema, [
      { type: 'manifest', url: 'http://example.com/skills.json' }
    ], 'skills registry')).toThrow('Invalid skills registry');
  });

  it('rejects unsupported install scopes', () => {
    expect(() => parseIpcInput(SkillPrepareInstallInputSchema, {
      id: 'research-brief',
      scope: '../workspace'
    }, 'skill install review request')).toThrow('Invalid skill install review request');
  });

  it('rejects empty skill request ids', () => {
    expect(() => parseIpcInput(SkillRequestInputSchema, {
      requestId: ''
    }, 'skill install request')).toThrow('Invalid skill install request');
  });

  it('keeps legacy string plugin actions scoped to public', () => {
    expect(parseIpcInput(PluginActionInputSchema, 'kairo-weather-plugin', 'plugin install request')).toEqual({
      id: 'kairo-weather-plugin',
      scope: 'public'
    });
  });
});
