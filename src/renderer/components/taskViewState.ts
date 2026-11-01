export interface TaskViewState {
  scrollTop?: number;
  previewFilePath?: string;
  directoryPath?: string;
  auxiliaryPanel?: 'files' | 'results' | 'details' | null;
}
