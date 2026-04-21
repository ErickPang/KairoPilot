export interface ToolSuccessResult<T = unknown> {
  __toolResult: true;
  ok: true;
  data: T;
  meta?: Record<string, unknown>;
}

export interface ToolFailureResult {
  __toolResult: true;
  ok: false;
  error: string;
  details?: unknown;
  meta?: Record<string, unknown>;
}

export type ToolExecutionResult<T = unknown> = ToolSuccessResult<T> | ToolFailureResult;

export function toolOk<T>(data: T, meta?: Record<string, unknown>): ToolSuccessResult<T> {
  return {
    __toolResult: true,
    ok: true,
    data,
    meta
  };
}

export function toolError(error: string, details?: unknown, meta?: Record<string, unknown>): ToolFailureResult {
  return {
    __toolResult: true,
    ok: false,
    error,
    details,
    meta
  };
}

export function isToolExecutionResult(value: unknown): value is ToolExecutionResult {
  return typeof value === 'object'
    && value !== null
    && '__toolResult' in value
    && (value as { __toolResult?: unknown }).__toolResult === true
    && 'ok' in value
    && typeof (value as { ok?: unknown }).ok === 'boolean';
}

export function unwrapToolExecutionResult(value: unknown): ToolExecutionResult {
  if (isToolExecutionResult(value)) {
    return value;
  }

  return toolOk(value);
}
