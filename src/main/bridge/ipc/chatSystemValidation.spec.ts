import { describe, expect, it } from 'vitest';
import { parseIpcInput } from './configValidation';
import {
  AuditLogQueryInputSchema,
  MonitoringTokenQueryInputSchema,
  OllamaPullInputSchema,
  PrepareAttachmentsInputSchema,
  RetryStepInputSchema,
  RunIdInputSchema,
  RunQueryInputSchema,
  RunTraceInputSchema,
  SelectFileInputSchema
} from './chatSystemValidation';

describe('chatSystemValidation', () => {
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

  it('rejects invalid run query filters', () => {
    expect(() => parseIpcInput(RunQueryInputSchema, {
      status: 'done'
    }, 'run query')).toThrow('Invalid run query');
  });

  it('normalizes run query pagination without failing the whole request', () => {
    expect(parseIpcInput(RunQueryInputSchema, {
      page: '2',
      pageSize: 500
    }, 'run query')).toEqual({
      page: 2,
      pageSize: 100
    });

    expect(parseIpcInput(RunQueryInputSchema, {
      page: 0,
      pageSize: Number.NaN
    }, 'run query')).toEqual({});
  });

  it('rejects retired run trace string input', () => {
    expect(()=>parseIpcInput(RunTraceInputSchema,'run-1','run trace query')).toThrow('Invalid run trace query');
  });

  it('normalizes run trace pagination to the backend trace limits', () => {
    expect(parseIpcInput(RunTraceInputSchema, {
      runId: 'run-1',
      page: '3',
      pageSize: 100,
      includeToolCalls: true
    }, 'run trace query')).toEqual({
      runId: 'run-1',
      page: 3,
      pageSize: 50,
      includeToolCalls: true
    });
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
