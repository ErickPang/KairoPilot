import type { RuntimeExecutionStatus, RuntimeInterruptSignal } from './runEngine';

export interface RunControlState {
  pauseRequested: boolean;
  cancelRequested: boolean;
}

export function createRunControlState(): RunControlState {
  return {
    pauseRequested: false,
    cancelRequested: false
  };
}

export class RuntimeRunControl {
  private controls = new Map<string, RunControlState>();

  start(runId: string) {
    this.controls.set(runId, createRunControlState());
  }

  requestPause(runId: string) {
    const control = this.controls.get(runId) ?? createRunControlState();
    control.pauseRequested = true;
    this.controls.set(runId, control);
  }

  requestCancel(runId: string) {
    const control = this.controls.get(runId) ?? createRunControlState();
    control.cancelRequested = true;
    this.controls.set(runId, control);
  }

  consume(runId: string): RuntimeInterruptSignal | null {
    const control = this.controls.get(runId);
    if (!control) {
      return null;
    }

    if (control.cancelRequested) {
      control.cancelRequested = false;
      this.controls.set(runId, control);
      return {
        kind: 'cancel',
        reason: 'Run cancelled by user.'
      };
    }

    if (control.pauseRequested) {
      control.pauseRequested = false;
      this.controls.set(runId, control);
      return {
        kind: 'pause',
        reason: 'Run paused by user.'
      };
    }

    return null;
  }

  reconcile(runId: string, status: RuntimeExecutionStatus) {
    if (status !== 'waiting_approval' && status !== 'paused') {
      this.controls.delete(runId);
      return;
    }

    if (status === 'paused') {
      const control = this.controls.get(runId);
      if (!control) {
        return;
      }

      control.pauseRequested = false;
      control.cancelRequested = false;
      this.controls.set(runId, control);
    }
  }

  clear(runId: string) {
    this.controls.delete(runId);
  }
}
