export type IpcSuccess<TExtra extends Record<string, unknown> = Record<string, never>> = {
  success: true;
} & TExtra;

export interface IpcFailure {
  success: false;
  error: string;
}

export type IpcResult<TExtra extends Record<string, unknown> = Record<string, never>> =
  | IpcSuccess<TExtra>
  | IpcFailure;

export function ipcSuccess(): IpcSuccess;
export function ipcSuccess<TExtra extends Record<string, unknown>>(extra: TExtra): IpcSuccess<TExtra>;
export function ipcSuccess<TExtra extends Record<string, unknown>>(extra?: TExtra) {
  return {
    success: true,
    ...(extra || {})
  };
}

export function ipcFailure(error: unknown): IpcFailure {
  return {
    success: false,
    error: error instanceof Error ? error.message : String(error || 'Unknown error')
  };
}
