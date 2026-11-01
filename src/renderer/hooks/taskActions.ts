export async function archiveTaskWithFeedback(actions: {
  saveDraft: () => Promise<void>;
  archive: () => Promise<void>;
  refresh: () => Promise<void>;
  reportError: (error: unknown) => void;
}): Promise<boolean> {
  try {
    await actions.saveDraft();
    await actions.archive();
    await actions.refresh();
    return true;
  } catch (error) { actions.reportError(error); return false; }
}
