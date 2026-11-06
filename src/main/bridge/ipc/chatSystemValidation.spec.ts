import { describe, expect, it } from 'vitest';
import { parseIpcInput } from './configValidation';
import {
  AuditLogQueryInputSchema,
  ApprovalResponseInputSchema,
  MonitoringTokenQueryInputSchema,
  OllamaPullInputSchema,
  PrepareAttachmentsInputSchema,
  RetryStepInputSchema,
  RunIdInputSchema,
  SelectFileInputSchema
} from './chatSystemValidation';

describe('chatSystemValidation', () => {
  it('accepts only explicit session approval and rejects forged scope or denied grants', () => {
    expect(ApprovalResponseInputSchema.parse({id:'a',approved:true})).toEqual({id:'a',approved:true,scope:'once'});
    expect(ApprovalResponseInputSchema.parse({id:'a',approved:true,scope:'session'}).scope).toBe('session');
    for (const value of [{id:'a',approved:false,scope:'session'},{id:'a',approved:true,scope:'global'},{id:'a',approved:true,sessionId:'other'}]) expect(()=>ApprovalResponseInputSchema.parse(value)).toThrow();
  });
  it('rejects empty run control ids', () => {
    expect(() => parseIpcInput(RunIdInputSchema, { runId: '' }, 'run pause request')).toThrow('Invalid run pause request');
    expect(() => parseIpcInput(RetryStepInputSchema, { runId: 'run-1', stepId: '' }, 'run retry request')).toThrow('Invalid run retry request');
  });

  it('rejects attachment preparation without files', () => {
    expect(() => parseIpcInput(PrepareAttachmentsInputSchema, {
      sessionId: 'session-1',
      files: []
    }, 'attachment prepare request')).toThrow('Invalid attachment prepare request');
  });

  it('rejects token detail queries with unknown fields', () => {
    expect(() => parseIpcInput(MonitoringTokenQueryInputSchema, {
      role: 'assistant',
      rawSql: 'SELECT * FROM messages'
    }, 'token usage query')).toThrow('Invalid token usage query');
  });

  it('normalizes structured audit query limits and rejects unsafe filters', () => {
    expect(()=>parseIpcInput(AuditLogQueryInputSchema,50,'audit log query')).toThrow('Invalid audit log query');

    expect(parseIpcInput(AuditLogQueryInputSchema, {
      page: '2',
      pageSize: 5000
    }, 'audit log query')).toEqual({
      page: 2,
      pageSize: 1000
    });

    expect(() => parseIpcInput(AuditLogQueryInputSchema, {
      status: 'pending'
    }, 'audit log query')).toThrow('Invalid audit log query');
  });

  it('accepts bounded dialog filters', () => {
    expect(parseIpcInput(SelectFileInputSchema, {
      filters: [
        { name: 'Archives', extensions: ['zip'] }
      ]
    }, 'file selection options')).toEqual({
      filters: [
        { name: 'Archives', extensions: ['zip'] }
      ]
    });
  });

  it('rejects unsafe Ollama model names', () => {
    expect(() => parseIpcInput(OllamaPullInputSchema, {
      baseUrl: 'http://localhost:11434',
      modelName: 'model;rm'
    }, 'Ollama pull request')).toThrow('Invalid Ollama pull request');
  });
});
