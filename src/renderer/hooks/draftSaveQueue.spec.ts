import { describe, expect, it, vi } from 'vitest';
import { DraftSaveQueue } from './draftSaveQueue';
const draft = (input: string) => ({ input, referenceIds: [], attachmentIds: [] });

describe('draft save queue', () => {
  it('cannot report an older matching snapshot as saved while a newer write is pending',async()=>{
    let finish!:(value:number)=>void;const writer=vi.fn(()=>new Promise<number>(resolve=>{finish=resolve;}));
    const queue=new DraftSaveQueue(writer);queue.adopt(1,draft('old'));
    const pending=queue.save(draft('temporary'));await Promise.resolve();
    expect(queue.matches(draft('old'))).toBe(true);expect(queue.isSettled(draft('old'))).toBe(false);
    await vi.waitFor(()=>expect(writer).toHaveBeenCalledOnce());finish(2);await pending;
    expect(queue.isSettled(draft('temporary'))).toBe(true);expect(queue.isSettled(draft('old'))).toBe(false);
  });
  it('serializes overlapping edits using the revision returned by the previous save', async () => {
    const revisions: number[] = [];
    const writer = vi.fn(async (revision: number) => { revisions.push(revision); await Promise.resolve(); return revision + 1; });
    const queue = new DraftSaveQueue(writer); queue.adopt(3, draft('old'));
    await Promise.all([queue.save(draft('first')), queue.save(draft('second'))]);
    expect(revisions).toEqual([3, 4]); expect(queue.matches(draft('second'))).toBe(true);
    expect(await queue.save(draft('second'))).toBe(5); expect(writer).toHaveBeenCalledTimes(2);
  });
  it('takes a snapshot so subsequent attachment mutations cannot alter an already queued write', async () => {
    const writer = vi.fn(async () => 1); const queue = new DraftSaveQueue(writer);
    const value = { input: 'text', referenceIds: ['file'], attachmentIds: ['upload'] };
    const save = queue.save(value); value.referenceIds.push('later'); value.attachmentIds.length = 0;
    await save;
    expect(writer).toHaveBeenCalledWith(0, { input: 'text', referenceIds: ['file'], attachmentIds: ['upload'] });
  });
  it('keeps the old revision after an ordinary storage failure and allows explicit retry', async () => {
    const writer = vi.fn().mockRejectedValueOnce(new Error('disk full')).mockResolvedValueOnce(8);
    const queue = new DraftSaveQueue(writer); queue.adopt(7, draft('saved'));
    await expect(queue.save(draft('unsaved'))).rejects.toThrow('disk full');
    expect(queue.matches(draft('saved'))).toBe(true);
    await expect(queue.save(draft('unsaved'))).resolves.toBe(8);
    expect(writer.mock.calls.map((call) => call[0])).toEqual([7, 7]);
  });
  it('blocks queued writes after a conflict until the latest revision is explicitly reviewed', async () => {
    const writer = vi.fn().mockRejectedValueOnce(new Error('DRAFT_CONFLICT: newer input')).mockResolvedValueOnce(11);
    const queue = new DraftSaveQueue(writer); queue.adopt(4, draft('old'));
    const results = await Promise.allSettled([queue.save(draft('local')), queue.save(draft('later local'))]);
    expect(results.every((result) => result.status === 'rejected')).toBe(true);
    expect(writer).toHaveBeenCalledTimes(1);
    await queue.idle(); queue.adopt(10, draft('reviewed saved input'));
    await expect(queue.save(draft('chosen local input'))).resolves.toBe(11);
    expect(writer).toHaveBeenLastCalledWith(10, draft('chosen local input'));
  });
});
