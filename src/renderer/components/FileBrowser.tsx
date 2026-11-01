import type { DragEvent } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { KAIRO_INVOKE } from '../../shared/ipc';
import { IconChevronDown, IconFolder, IconRefresh, IconSearch, IconX } from './Icons';
import { useTranslation } from '../hooks/useTranslation';

interface FileEntry {
  name: string;
  path: string;
  isDirectory: boolean;
}

interface TreeNode extends FileEntry {
  children?: TreeNode[];
  loaded: boolean;
  expanded: boolean;
}

function toTreeNode(entry: FileEntry): TreeNode {
  return {
    ...entry,
    loaded: false,
    expanded: false
  };
}

function buildInitialTree(rootPath: string): TreeNode {
  return {
    name: rootPath.split(/[/\\]/).pop() || rootPath,
    path: rootPath,
    isDirectory: true,
    loaded: false,
    expanded: false,
  };
}

async function loadChildren(nodePath: string): Promise<FileEntry[]> {
  const result = await window.kairo.invoke(KAIRO_INVOKE.systemListDirectory, nodePath);
  if (result && typeof result === 'object' && 'children' in result) {
    return (result as { children: FileEntry[] }).children;
  }
  return [];
}

function getFileBadge(name: string, isDirectory: boolean): string {
  if (isDirectory) return '';
  const ext = name.split('.').pop()?.toLowerCase();
  return (ext || 'file').slice(0, 4).toUpperCase();
}

function updateTreeNode(node: TreeNode, targetPath: string, updater: (current: TreeNode) => TreeNode): TreeNode {
  if (node.path === targetPath) {
    return updater(node);
  }

  if (!node.children?.length) {
    return node;
  }

  return {
    ...node,
    children: node.children.map((child) => updateTreeNode(child, targetPath, updater))
  };
}

function filterTree(node: TreeNode, query: string): TreeNode | null {
  if (!query) {
    return node;
  }

  const normalizedName = node.name.toLowerCase();
  const ownMatch = normalizedName.includes(query);
  if (!node.isDirectory) {
    return ownMatch ? node : null;
  }

  const filteredChildren = (node.children ?? [])
    .map((child) => filterTree(child, query))
    .filter((child): child is TreeNode => Boolean(child));

  if (ownMatch || filteredChildren.length > 0) {
    return {
      ...node,
      expanded: true,
      children: filteredChildren
    };
  }

  return null;
}

function countVisibleFiles(node: TreeNode | null): number {
  if (!node) {
    return 0;
  }

  if (!node.isDirectory) {
    return 1;
  }

  return (node.children ?? []).reduce((total, child) => total + countVisibleFiles(child), 0);
}

function TreeNodeItem({
  node,
  depth,
  selectedPath,
  loadingPaths,
  onToggle,
  onSelect,
  onReference
}: {
  node: TreeNode;
  depth: number;
  selectedPath: string | null;
  loadingPaths: Set<string>;
  onToggle: (node: TreeNode) => void;
  onSelect: (filePath: string) => void;
  onReference?: (path: string) => void;
}) {
  const { t } = useTranslation();
  const isSelected = selectedPath === node.path;
  const isLoading = loadingPaths.has(node.path);
  const indent = 12 + depth * 14;

  const handleClick = () => {
    if (node.isDirectory) {
      onToggle(node);
      return;
    }
    onSelect(node.path);
  };

  const handleDragStart = useCallback((e: DragEvent<HTMLDivElement>) => {
    if (node.isDirectory) return;
    e.dataTransfer.setData('text/plain', node.path);
    e.dataTransfer.effectAllowed = 'copy';
  }, [node.isDirectory, node.path]);

  return (
    <div>
      <div
        className={`file-browser-item ${node.isDirectory ? 'is-directory' : 'is-file'} ${isSelected ? 'active' : ''}`}
        style={{ paddingLeft: indent }}
        role="button" tabIndex={0}
        onKeyDown={(event) => { if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); handleClick(); } }}
        onClick={handleClick}
        onDragStart={handleDragStart}
        draggable={!node.isDirectory}
        title={node.path}
      >
        <span className={`file-browser-item-caret ${node.isDirectory ? 'is-visible' : ''} ${node.expanded ? 'is-open' : ''}`}>
          <IconChevronDown size={14} />
        </span>
        <span className={`file-browser-item-icon ${node.isDirectory ? 'is-folder' : 'is-file'}`}>
          {node.isDirectory ? <IconFolder size={14} /> : getFileBadge(node.name, false)}
        </span>
        <span className="file-browser-item-name">{node.name}</span>
        {onReference && <button type="button" className="file-browser-reference" title={t(node.isDirectory ? 'workbench.referenceDirectory' : 'filePreview.insertPath')} aria-label={`${t(node.isDirectory ? 'workbench.referenceDirectory' : 'filePreview.insertPath')}: ${node.name}`} onClick={(event) => { event.stopPropagation(); onReference(node.path); }}>+</button>}
        {isLoading && <span className="file-browser-item-meta">...</span>}
      </div>
      {node.isDirectory && node.expanded && node.children && (
        <div>
          {node.children.map((child) => (
            <TreeNodeItem
              key={child.path}
              node={child}
              depth={depth + 1}
              selectedPath={selectedPath}
              loadingPaths={loadingPaths}
              onToggle={onToggle}
              onSelect={onSelect}
              onReference={onReference}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function FileBrowser({
  rootPath,
  onFileSelect,
  onReference,
}: {
  rootPath: string;
  onFileSelect?: (filePath: string) => void;
  onReference?: (path: string) => void;
}) {
  const { t } = useTranslation();
  const [root, setRoot] = useState<TreeNode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [loadingRoot, setLoadingRoot] = useState(false);
  const [loadingPaths, setLoadingPaths] = useState<Set<string>>(new Set());

  const loadRoot = useCallback(async () => {
    if (!rootPath) return;
    setLoadingRoot(true);
    setError(null);
    setSelectedPath(null);
    const rootNode = buildInitialTree(rootPath);
    setRoot(rootNode);
    try {
      const entries = await loadChildren(rootPath);
      setRoot({
        ...rootNode,
        children: entries.map(toTreeNode),
        loaded: true,
        expanded: true
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoadingRoot(false);
    }
  }, [rootPath]);

  useEffect(() => {
    void loadRoot();
  }, [loadRoot]);

  const handleToggle = useCallback(async (node: TreeNode) => {
    if (!node.isDirectory) {
      return;
    }

    if (node.loaded) {
      setRoot((prev) => (prev ? updateTreeNode(prev, node.path, (current) => ({ ...current, expanded: !current.expanded })) : prev));
      return;
    }

    setLoadingPaths((prev) => new Set(prev).add(node.path));
    try {
      const entries = await loadChildren(node.path);
      setRoot((prev) => (
        prev
          ? updateTreeNode(prev, node.path, (current) => ({
              ...current,
              children: entries.map(toTreeNode),
              loaded: true,
              expanded: true
            }))
          : prev
      ));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoadingPaths((prev) => {
        const next = new Set(prev);
        next.delete(node.path);
        return next;
      });
    }
  }, []);

  const handleSelect = useCallback(
    (filePath: string) => {
      setSelectedPath(filePath);
      onFileSelect?.(filePath);
    },
    [onFileSelect]
  );

  const filteredRoot = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!root || !normalizedQuery) {
      return root;
    }
    return filterTree(root, normalizedQuery);
  }, [query, root]);

  const visibleFileCount = useMemo(() => countVisibleFiles(filteredRoot), [filteredRoot]);
  const rootName = useMemo(() => rootPath.split(/[/\\]/).pop() || rootPath, [rootPath]);

  if (error) {
    return (
      <div className="file-browser file-browser-shell">
        <div className="file-browser-header">
          <div>
            <div className="file-browser-title">{t('fileBrowser.title')}</div>
            <div className="file-browser-subtitle">{rootName}</div>
          </div>
        </div>
        <div className="file-browser-error">{error}</div>
      </div>
    );
  }

  return (
    <div className="file-browser file-browser-shell">
      <div className="file-browser-header">
        <div>
          <div className="file-browser-title">{t('fileBrowser.title')}</div>
          <div className="file-browser-subtitle">{rootName}</div>
        </div>
        <button
          type="button"
          className="file-browser-action"
          onClick={() => void loadRoot()}
          title={t('fileBrowser.refresh')}
        >
          <IconRefresh size={14} />
        </button>
      </div>
      <div className="file-browser-toolbar">
        <div className="file-browser-search">
          <IconSearch size={14} />
          <input
            type="text"
            className="file-browser-search-input"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('fileBrowser.searchPlaceholder')}
          />
          {query && (
            <button
              type="button"
              className="file-browser-search-clear"
              onClick={() => setQuery('')}
              title={t('common.clear')}
            >
              <IconX size={12} />
            </button>
          )}
        </div>
        <div className="file-browser-summary">{visibleFileCount} {t('fileBrowser.resultsSuffix')}</div>
      </div>
      <div className="file-browser-tree">
        {loadingRoot && <div className="file-browser-empty-state">{t('fileBrowser.loading')}</div>}
        {!loadingRoot && filteredRoot && (
          <TreeNodeItem
            node={filteredRoot}
            depth={0}
            selectedPath={selectedPath}
            loadingPaths={loadingPaths}
            onToggle={handleToggle}
            onSelect={handleSelect}
            onReference={onReference}
          />
        )}
        {!loadingRoot && !filteredRoot && <div className="file-browser-empty-state">{t('fileBrowser.noMatches')}</div>}
      </div>
    </div>
  );
}
