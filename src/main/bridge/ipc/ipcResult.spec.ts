import { describe, expect, it } from 'vitest';
import { ipcFailure, ipcSuccess } from './ipcResult';

describe('ipcResult', () => {
  it('creates stable success payloads with optional extra fields', () => {
    expect(ipcSuccess()).toEqual({ success: true });
    expect(ipcSuccess({ deleted: true })).toEqual({
      success: true,
      deleted: true
    });
  });

  it('normalizes unknown failures into string errors', () => {
    expect(ipcFailure(new Error('failed'))).toEqual({
      success: false,
      error: 'failed'
    });
    expect(ipcFailure('bad input')).toEqual({
      success: false,
      error: 'bad input'
    });
  });
});
