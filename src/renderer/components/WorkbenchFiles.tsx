import { FileBrowser } from './FileBrowser';
import { FilePreview } from './FilePreview';
import { useTranslation } from '../hooks/useTranslation';

interface Props {
  taskKey: string;
  workspacePath: string;
  directoryPath?: string;
  filePath: string | null;
  expanded: boolean;
  disabled: boolean;
  onSelectFile: (path: string) => void;
  onReference: (path: string) => void;
  onRoot: () => void;
  onToggleExpand: () => void;
}

export function WorkbenchFiles(props: Props) {
  const { t } = useTranslation();
  return <div className={`workbench-files ${props.filePath ? 'has-file' : ''}`}>
    <div className="workbench-reference-tools">
      <button type="button" disabled={props.disabled || !props.workspacePath} onClick={() => props.onReference(props.directoryPath || props.workspacePath)}>{t('workbench.referenceDirectory')}</button>
      {props.directoryPath && <button type="button" onClick={props.onRoot}>{t('workbench.returnRoot')}</button>}
    </div>
    <FileBrowser key={`${props.taskKey}:${props.directoryPath || ''}`} rootPath={props.directoryPath || props.workspacePath} onFileSelect={props.onSelectFile} onReference={props.disabled ? undefined : props.onReference}/>
    {props.filePath && <FilePreview key={`${props.taskKey}:${props.filePath}`} filePath={props.filePath} onInsertPath={props.disabled ? undefined : props.onReference} isExpanded={props.expanded} onToggleExpand={props.onToggleExpand}/>}
  </div>;
}
