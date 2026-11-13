import type { TaskDraftInput, QuitDraftFailureReason } from '../../shared/contracts';

export class DraftQuitError extends Error {
  constructor(readonly reason: QuitDraftFailureReason) { super(reason); }
}

export function isDraftConflict(error: unknown): boolean {
  return String(error).includes('DRAFT_CONFLICT:');
}

export function draftContent(data: TaskDraftInput): string {
  return JSON.stringify({ input: data.input, referenceIds: data.referenceIds, attachmentIds: data.attachmentIds });
}

/** Serializes saves without retrying a conflicting write against an unseen revision. */
export class DraftSaveQueue {
  private revision = 0;
  private persisted = '';
  private blocked = false;
  private pending: Promise<unknown> = Promise.resolve();
  private pendingCount = 0;

  constructor(private write: (revision: number, data: TaskDraftInput) => Promise<number>) {}

  adopt(revision: number, data: TaskDraftInput) {
    this.revision = revision;
    this.persisted = draftContent(data);
    this.blocked = false;
  }

  matches(data: TaskDraftInput): boolean { return this.persisted === draftContent(data); }
  isSettled(data: TaskDraftInput): boolean { return this.pendingCount === 0 && this.matches(data); }
  idle(): Promise<unknown> { return this.pending.catch(() => undefined); }

  save(data: TaskDraftInput): Promise<number> {
    const snapshot = { input: data.input, referenceIds: [...data.referenceIds], attachmentIds: [...data.attachmentIds] };
    this.pendingCount++;
    const operation = this.pending.catch(() => undefined).then(async () => {
      if (this.blocked) throw new Error('DRAFT_CONFLICT: Reload the saved revision before retrying.');
      if (this.matches(snapshot)) return this.revision;
      try {
        const next = await this.write(this.revision, snapshot);
        this.adopt(next, snapshot);
        return next;
      } catch (error) {
        if (isDraftConflict(error)) this.blocked = true;
        throw error;
      }
    });
    const settled = operation.finally(() => { this.pendingCount--; });
    this.pending = settled;
    return settled;
  }
}
