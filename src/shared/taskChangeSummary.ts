import type { TaskArtifact, TaskChangeSummary } from './contracts';

/** Input follows the evidence store's newest-first operation order, not wall-clock time. */
export function summarizeTaskChanges(newestFirst: TaskArtifact[]): TaskChangeSummary[] {
  const files = new Map<string, TaskArtifact[]>();
  for (const artifact of [...newestFirst].reverse()) {
    const entries = files.get(artifact.path) || [];
    entries.push(artifact); files.set(artifact.path, entries);
  }
  return [...files].map(([path, entries]) => {
    const first = entries[0]; const last = entries[entries.length - 1];
    const startsAbsent = first.operation === 'created';
    const endsAbsent = last.operation === 'deleted';
    const hasDiscontinuity = first.operation === 'written' || entries.some((entry, index) => {
      if (index === 0) return false;
      const previous = entries[index - 1];
      if (previous.operation === 'deleted' && entry.operation === 'created') return false;
      return !previous.afterHash || !entry.beforeHash || previous.afterHash !== entry.beforeHash;
    });
    return {
      path, artifactIds: entries.map((entry) => entry.id), runIds: [...new Set(entries.map((entry) => entry.runId))],
      operation: startsAbsent ? endsAbsent ? 'no_remaining_file' : 'created' : endsAbsent ? 'deleted' : 'modified',
      hasDiscontinuity,
      diffAvailable: first.diffAvailable && last.diffAvailable && entries.every((entry) => entry.availability !== 'denied'),
      availability: entries.some((entry) => entry.availability === 'denied') ? 'denied' : last.availability || 'available'
    };
  });
}
