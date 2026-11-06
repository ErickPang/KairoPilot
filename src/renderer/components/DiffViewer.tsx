import { WorkbenchDialog } from './WorkbenchDialog';
import { useMemo, useState } from 'react';
import { useTranslation } from '../hooks/useTranslation';

// ---------------------------------------------------------------------------
// Lightweight line-level diff (LCS-based)
// ---------------------------------------------------------------------------
interface DiffLine {
  type: 'unchanged' | 'added' | 'removed';
  lineNumber: { left?: number; right?: number };
  content: string;
}

interface DiffHunk {
  lines: DiffLine[];
  startLeft: number;
  startRight: number;
}

function computeLCS(a: string[], b: string[]): number[][] {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }
  return dp;
}

function backtrackDiff(a: string[], b: string[]): DiffLine[] {
  const dp = computeLCS(a, b);
  const result: DiffLine[] = [];
  let i = a.length;
  let j = b.length;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
      result.unshift({ type: 'unchanged', lineNumber: { left: i, right: j }, content: a[i - 1] });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      result.unshift({ type: 'added', lineNumber: { right: j }, content: b[j - 1] });
      j--;
    } else {
      result.unshift({ type: 'removed', lineNumber: { left: i }, content: a[i - 1] });
      i--;
    }
  }
  return result;
}

function groupIntoHunks(diffLines: DiffLine[], contextLines = 3): DiffHunk[] {
  const hunks: DiffHunk[] = [];
  let currentHunk: DiffLine[] = [];
  let unchangedBuffer: DiffLine[] = [];

  const flushHunk = (lines: DiffLine[]) => {
    const firstLine = lines[0];
    hunks.push({
      lines,
      startLeft: firstLine?.lineNumber?.left ?? 0,
      startRight: firstLine?.lineNumber?.right ?? 0,
    });
  };

  const flushBuffer = () => {
    if (unchangedBuffer.length > contextLines && currentHunk.length > 0) {
      currentHunk.push(...unchangedBuffer.slice(0, contextLines));
      flushHunk(currentHunk);
      const remaining = unchangedBuffer.slice(-contextLines);
      currentHunk = [...remaining];
      unchangedBuffer = [];
    } else if (currentHunk.length > 0) {
      currentHunk.push(...unchangedBuffer);
      unchangedBuffer = [];
    }
  };

  for (const line of diffLines) {
    if (line.type === 'unchanged') {
      unchangedBuffer.push(line);
    } else {
      flushBuffer();
      if (currentHunk.length === 0 && unchangedBuffer.length > contextLines) {
        // Take trailing context before the change
        const ctx = unchangedBuffer.slice(-contextLines);
        currentHunk.push(...ctx);
      } else if (currentHunk.length === 0) {
        currentHunk.push(...unchangedBuffer);
      }
      unchangedBuffer = [];
      currentHunk.push(line);
    }
  }

  // Flush remaining
  if (unchangedBuffer.length > 0 && currentHunk.length > 0) {
    const ctx = unchangedBuffer.slice(0, contextLines);
    currentHunk.push(...ctx);
  }
  if (currentHunk.length > 0) {
    flushHunk(currentHunk);
  }

  return hunks;
}

// ---------------------------------------------------------------------------
// DiffViewer Component
// ---------------------------------------------------------------------------
export function DiffViewer({
  oldText,
  newText,
  filePath,
  viewMode = 'unified',
}: {
  oldText: string;
  newText: string;
  filePath?: string;
  viewMode?: 'unified' | 'split';
}) {
  const { t } = useTranslation();
  const [activeViewMode, setViewMode] = useState(viewMode);
  const exceedsLimit = oldText.length + newText.length > 256 * 1024 || oldText.split('\n').length * newText.split('\n').length > 250000;

  const hunks = useMemo(() => {
    if (exceedsLimit) return [];
    const oldLines = oldText.split('\n');
    const newLines = newText.split('\n');
    const diffLines = backtrackDiff(oldLines, newLines);
    return groupIntoHunks(diffLines, 3);
  }, [oldText, newText, exceedsLimit]);

  const totalAdded = useMemo(
    () => hunks.reduce((sum, h) => sum + h.lines.filter((l) => l.type === 'added').length, 0),
    [hunks]
  );
  const totalRemoved = useMemo(
    () => hunks.reduce((sum, h) => sum + h.lines.filter((l) => l.type === 'removed').length, 0),
    [hunks]
  );

  if (exceedsLimit) return <p className="workbench-panel-empty">{t('workbench.diffTooLarge')}</p>;
  if (oldText === newText) {
    return (
      <div className="diff-viewer">
        <div className="diff-viewer-header">
          <span className="diff-viewer-path">{filePath || t('workbench.files')}</span>
          <span className="diff-viewer-nochanges">{t('workbench.noTrackedChanges')}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="diff-viewer">
      <div className="diff-viewer-header">
        <span className="diff-viewer-path" title={filePath}>
          {filePath || t('workbench.files')}
        </span>
        <div className="diff-viewer-stats">
          <span className="diff-stat-added">+{totalAdded}</span>
          <span className="diff-stat-removed">-{totalRemoved}</span>
          <div className="diff-viewer-mode-toggle">
            <button
              type="button"
              className={`diff-mode-btn ${activeViewMode === 'unified' ? 'active' : ''}`}
              onClick={() => setViewMode('unified')}
            >
              {t('workbench.unifiedDiff')}
            </button>
            <button
              type="button"
              className={`diff-mode-btn ${activeViewMode === 'split' ? 'active' : ''}`}
              onClick={() => setViewMode('split')}
            >
              {t('workbench.splitDiff')}
            </button>
          </div>
        </div>
      </div>

      <div className={`diff-viewer-content diff-viewer-${activeViewMode}`}>
        {hunks.map((hunk, hunkIdx) => (
          <div key={hunkIdx} className="diff-hunk">
            <div className="diff-hunk-header">
              @@ -{hunk.startLeft},{hunk.lines.length} +{hunk.startRight},{hunk.lines.length} @@
            </div>
            {hunk.lines.map((line, lineIdx) => (
              <div
                key={`${hunkIdx}-${lineIdx}`}
                className={`diff-line diff-line-${line.type}`}
              >
                {activeViewMode === 'split' && (
                  <>
                    <span className="diff-line-num diff-line-num-left">
                      {line.lineNumber.left ?? ''}
                    </span>
                    <span className="diff-line-content diff-line-content-left">
                      <span className="diff-line-prefix">
                        {line.type === 'removed' ? '-' : line.type === 'unchanged' ? ' ' : ''}
                      </span>
                      {line.type !== 'added' ? line.content : ''}
                    </span>
                    <span className="diff-line-num diff-line-num-right">
                      {line.lineNumber.right ?? ''}
                    </span>
                    <span className="diff-line-content diff-line-content-right">
                      <span className="diff-line-prefix">
                        {line.type === 'added' ? '+' : line.type === 'unchanged' ? ' ' : ''}
                      </span>
                      {line.type !== 'removed' ? line.content : ''}
                    </span>
                  </>
                )}
                {activeViewMode !== 'split' && (
                  <>
                    <span className="diff-line-num diff-line-num-left">
                      {line.lineNumber.left ?? ''}
                    </span>
                    <span className="diff-line-num diff-line-num-right">
                      {line.lineNumber.right ?? ''}
                    </span>
                    <span className="diff-line-prefix">
                      {line.type === 'added' ? '+' : line.type === 'removed' ? '-' : ' '}
                    </span>
                    <span className="diff-line-content">{line.content}</span>
                  </>
                )}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// DiffModal — convenient wrapper for showing diff in a modal
// ---------------------------------------------------------------------------
export function DiffModal({
  oldText,
  newText,
  filePath,
  onClose,
}: {
  oldText: string;
  newText: string;
  filePath: string;
  onClose: () => void;
}) {
  return (
<WorkbenchDialog kind="diff" className="diff-modal" title="变更预览" onClose={onClose}>
      <DiffViewer oldText={oldText} newText={newText} filePath={filePath}/>
    </WorkbenchDialog>
  );
}
