import type { TaskDraftInput } from '../../shared/contracts';

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

  constructor(private write: (revision: number, data: TaskDraftInput) => Promise<number>) {}

  adopt(revision: number, data: TaskDraftInput) {
    this.revision = revision;
    this.persisted = draftContent(data);
    this.blocked = false;
  }

  matches(data: TaskDraftInput): boolean { return this.persisted === draftContent(data); }
  idle(): Promise<unknown> { return this.pending.catch(() => undefined); }

  save(data: TaskDraftInput): Promise<number> {
    const snapshot = { input: data.input, referenceIds: [...data.referenceIds], attachmentIds: [...data.attachmentIds] };
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
    this.pending = operation;
    return operation;
  }
}
