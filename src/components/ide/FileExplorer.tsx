import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Copy,
  ExternalLink,
  FilePlus,
  FolderOpen,
  FolderPlus,
  GitBranch,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import type { FileNode } from '@shared/types';
import { useCoreStore } from '../../store/core';
import { useEditorStore } from '../../store/editor';
import { him, cleanErrorMessage } from '../../lib/bridge';
import { cn, basename, dirname, relativeTo } from '../../lib/utils';
import { toast } from '../../store/toast';
import { openWorkspace } from '../../lib/actions';
import { Button, ConfirmDialog, IconButton, Modal } from '../ui';
import { FileTypeIcon } from '../FileIcon';

interface TreeDialog {
  kind: 'file' | 'folder' | 'rename';
  baseDir: string;
  oldPath?: string;
  initial: string;
}

interface ContextMenuState {
  x: number;
  y: number;
  node: FileNode | null;
}

function normalizePath(value: string): string {
  return value.replaceAll('\\', '/');
}

const EXPLORER_HIDDEN = new Set([
  '.git',
  'node_modules',
  'dist',
  'dist-electron',
  'release',
  'build',
  'out',
  '.next',
  '.nuxt',
  '.turbo',
  '.cache',
  '.npm-cache',
  '.electron-cache',
  '.smoke',
  '.smoke-config',
  '.smoke-workspace',
  'coverage',
]);

export function FileExplorer() {
  const workspace = useCoreStore((state) => state.workspace);
  const git = useCoreStore((state) => state.git);
  const fsRevision = useCoreStore((state) => state.fsRevision);
  const activePath = useEditorStore((state) => state.activePath);
  const openFile = useEditorStore((state) => state.openFile);
  const closeTab = useEditorStore((state) => state.closeTab);
  const closeTabsUnder = useEditorStore((state) => state.closeTabsUnder);
  const updatePath = useEditorStore((state) => state.updatePath);
  const [children, setChildren] = useState<Record<string, FileNode[]>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState<Set<string>>(new Set());
  const [rootError, setRootError] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [dialog, setDialog] = useState<TreeDialog | null>(null);
  const [dialogName, setDialogName] = useState('');
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<FileNode | null>(null);
  const [busy, setBusy] = useState(false);
  const expandedRef = useRef(expanded);
  useEffect(() => {
    expandedRef.current = expanded;
  }, [expanded]);
  const dialogInputRef = useRef<HTMLInputElement>(null);

  const loadDir = useCallback(async (dir: string, isRoot = false) => {
    const normalized = normalizePath(dir);
    setLoading((previous) => new Set(previous).add(normalized));
    try {
      const entries = await him.fs.readDir(normalized);
      const normalizedEntries = entries
        .filter((entry) => !EXPLORER_HIDDEN.has(entry.name))
        .map((entry) => ({
          ...entry,
          path: normalizePath(entry.path),
        }));
      setChildren((previous) => ({ ...previous, [normalized]: normalizedEntries }));
      if (isRoot) setRootError(null);
    } catch (error) {
      if (isRoot) setRootError(cleanErrorMessage(error));
      else toast('error', cleanErrorMessage(error), 'Could not read folder');
    } finally {
      setLoading((previous) => {
        const next = new Set(previous);
        next.delete(normalized);
        return next;
      });
    }
  }, []);

  useEffect(() => {
    setChildren({});
    setExpanded(new Set());
    setRootError(null);
    setContextMenu(null);
    if (workspace) void loadDir(normalizePath(workspace), true);
  }, [workspace, loadDir]);

  useEffect(() => {
    if (!workspace) return;
    const root = normalizePath(workspace);
    void loadDir(root);
    for (const dir of expandedRef.current) {
      void loadDir(dir);
    }
  }, [fsRevision, workspace, loadDir]);

  useEffect(() => {
    if (!dialog) return;
    const timer = window.setTimeout(() => {
      dialogInputRef.current?.focus();
      dialogInputRef.current?.select();
    }, 30);
    return () => window.clearTimeout(timer);
  }, [dialog]);

  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    window.addEventListener('mousedown', close);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('resize', close);
    };
  }, [contextMenu]);

  const gitFiles = useMemo(() => {
    const map = new Map<string, string>();
    for (const file of git?.files || []) {
      map.set(normalizePath(file.path).toLowerCase(), file.letter);
    }
    return map;
  }, [git]);

  const changedDirs = useMemo(() => {
    const set = new Set<string>();
    for (const file of git?.files || []) {
      const parts = normalizePath(file.path).split('/');
      for (let i = 1; i < parts.length; i += 1) {
        set.add(parts.slice(0, i).join('/').toLowerCase());
      }
    }
    return set;
  }, [git]);

  const toggleFolder = (node: FileNode) => {
    const key = normalizePath(node.path);
    const next = new Set(expanded);
    if (next.has(key)) {
      next.delete(key);
    } else {
      next.add(key);
      if (!children[key]) void loadDir(key);
    }
    setExpanded(next);
  };

  const openDialog = (kind: TreeDialog['kind'], baseDir: string, initial = '', oldPath?: string) => {
    setDialog({ kind, baseDir, initial, oldPath });
    setDialogName(initial);
    setDialogError(null);
    setContextMenu(null);
  };

  const submitDialog = async () => {
    if (!dialog) return;
    const name = dialogName.trim();
    if (!name) return;
    if (name === '.' || name === '..' || /[\\/]/.test(name)) {
      setDialogError('Use a simple name without slashes.');
      return;
    }
    setBusy(true);
    setDialogError(null);
    try {
      if (dialog.kind === 'rename' && dialog.oldPath) {
        const target = `${normalizePath(dialog.baseDir).replace(/\/+$/, '')}/${name}`;
        if (target !== dialog.oldPath) {
          await him.fs.rename(dialog.oldPath, target);
          updatePath(dialog.oldPath, normalizePath(target));
          toast('success', `Renamed to ${name}.`, 'File renamed');
        }
      } else {
        const target = `${normalizePath(dialog.baseDir).replace(/\/+$/, '')}/${name}`;
        await him.fs.create(target, dialog.kind === 'folder' ? 'directory' : 'file');
        if (dialog.kind === 'file') void openFile(normalizePath(target));
        toast('success', `${name} created.`, dialog.kind === 'folder' ? 'Folder' : 'File');
      }
      await loadDir(dialog.baseDir);
      useCoreStore.getState().bumpFs();
      void useCoreStore.getState().refreshGit();
      setDialog(null);
    } catch (error) {
      setDialogError(cleanErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    const target = deleteTarget;
    setDeleteTarget(null);
    try {
      await him.fs.trash(target.path);
      if (target.isDirectory) closeTabsUnder(target.path);
      else closeTab(target.path);
      useCoreStore.getState().bumpFs();
      void useCoreStore.getState().refreshGit();
      toast('success', `${target.name} moved to the recycle bin.`, 'Deleted');
    } catch (error) {
      toast('error', cleanErrorMessage(error), 'Delete failed');
    }
  };

  const copyRelative = (node: FileNode) => {
    if (!workspace) return;
    void navigator.clipboard.writeText(relativeTo(workspace, node.path));
    toast('success', 'Relative path copied.');
  };

  const renderNodes = (dir: string, depth: number): ReactNode => {
    const entries = children[dir];
    if (!entries) {
      if (loading.has(dir)) {
        return (
          <div className="space-y-1 px-2 py-1">
            {[0, 1, 2, 3].map((row) => (
              <div
                key={row}
                className="h-5 animate-pulse rounded bg-ink-800/70"
                style={{ marginLeft: depth * 10, width: `${70 - row * 6}%` }}
              />
            ))}
          </div>
        );
      }
      return null;
    }
    if (entries.length === 0) {
      return (
        <div
          className="px-2 py-1.5 text-[9px] italic text-mist-ghost"
          style={{ paddingLeft: 12 + depth * 12 }}
        >
          empty folder
        </div>
      );
    }
    return entries.map((node) => {
      const normalized = normalizePath(node.path);
      const isOpen = expanded.has(normalized);
      const relative = workspace ? normalizePath(relativeTo(workspace, normalized)) : node.name;
      const gitLetter = gitFiles.get(relative.toLowerCase());
      const isActive = Boolean(
        activePath &&
          activePath.replaceAll('\\', '/').toLowerCase() === normalized.toLowerCase(),
      );
      const hasChangedChildren =
        node.isDirectory && changedDirs.has(relative.toLowerCase());
      return (
        <div key={normalized}>
          <div
            role="button"
            tabIndex={0}
            onClick={() => {
              if (node.isDirectory) toggleFolder(node);
              else void openFile(normalized);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                if (node.isDirectory) toggleFolder(node);
                else void openFile(normalized);
              }
            }}
            onContextMenu={(event) => {
              event.preventDefault();
              event.stopPropagation();
              setContextMenu({
                x: Math.min(event.clientX, window.innerWidth - 210),
                y: Math.min(event.clientY, window.innerHeight - 230),
                node,
              });
            }}
            title={relative}
            className={cn(
              'group flex h-[23px] cursor-default select-none items-center gap-1 pr-2 text-[10.5px] outline-none transition-colors',
              isActive
                ? 'bg-accent/[0.08] text-mist-bright'
                : 'text-mist-dim hover:bg-ink-800/70 hover:text-mist',
            )}
            style={{ paddingLeft: 7 + depth * 12 }}
          >
            {node.isDirectory ? (
              <ChevronRight
                size={9}
                className={cn(
                  'shrink-0 text-mist-ghost transition-transform',
                  isOpen && 'rotate-90',
                )}
              />
            ) : (
              <span className="w-[9px] shrink-0" />
            )}
            <FileTypeIcon
              name={node.name}
              isDirectory={node.isDirectory}
              expanded={isOpen}
              size={13}
            />
            <span className="min-w-0 flex-1 truncate">{node.name}</span>
            {hasChangedChildren && !gitLetter && (
              <span className="h-1 w-1 shrink-0 rounded-full bg-sand/60" />
            )}
            {gitLetter && (
              <span
                className={cn(
                  'shrink-0 font-mono text-[8px]',
                  gitLetter === 'M'
                    ? 'text-sand'
                    : gitLetter === 'D'
                      ? 'text-coral'
                      : gitLetter === 'A' || gitLetter === 'U'
                        ? 'text-mint'
                        : gitLetter === 'R'
                          ? 'text-azure'
                          : 'text-mist-faint',
                )}
              >
                {gitLetter}
              </span>
            )}
          </div>
          {node.isDirectory && isOpen && (
            <div>{renderNodes(normalized, depth + 1)}</div>
          )}
        </div>
      );
    });
  };

  const headerActions = (
    <div className="flex items-center gap-0.5">
      <IconButton
        label="New file"
        size="xs"
        disabled={!workspace}
        onClick={() => workspace && openDialog('file', normalizePath(workspace))}
      >
        <FilePlus size={12} />
      </IconButton>
      <IconButton
        label="New folder"
        size="xs"
        disabled={!workspace}
        onClick={() => workspace && openDialog('folder', normalizePath(workspace))}
      >
        <FolderPlus size={12} />
      </IconButton>
      <IconButton
        label="Refresh explorer"
        size="xs"
        disabled={!workspace}
        onClick={() => {
          useCoreStore.getState().bumpFs();
          void useCoreStore.getState().refreshGit();
        }}
      >
        <RefreshCw size={11} />
      </IconButton>
      <IconButton
        label="Collapse folders"
        size="xs"
        disabled={!workspace}
        onClick={() => setExpanded(new Set())}
      >
        <ChevronUp size={12} />
      </IconButton>
    </div>
  );

  return (
    <div className="flex h-full min-h-0 flex-col bg-ink-850/45">
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-line px-2.5">
        <span className="text-[9.5px] font-semibold uppercase tracking-[0.16em] text-mist-faint">
          Explorer
        </span>
        {headerActions}
      </div>
      {workspace && (
        <div className="flex h-7 shrink-0 items-center gap-1.5 border-b border-line/70 px-2.5 text-[9px] text-mist-faint">
          <ChevronDown size={9} className="text-mist-ghost" />
          <FolderOpen size={10} className="text-accent-dim" />
          <span className="min-w-0 flex-1 truncate font-medium uppercase tracking-[0.06em]">
            {basename(workspace)}
          </span>
          {git?.isRepo && git.branch && (
            <span className="flex items-center gap-1 font-mono text-[8px] text-mist-ghost">
              <GitBranch size={8} /> {git.branch}
            </span>
          )}
        </div>
      )}
      <div
        className="thin-scrollbar min-h-0 flex-1 overflow-y-auto py-1"
        onContextMenu={(event) => {
          if (!workspace) return;
          event.preventDefault();
          setContextMenu({
            x: Math.min(event.clientX, window.innerWidth - 210),
            y: Math.min(event.clientY, window.innerHeight - 230),
            node: null,
          });
        }}
      >
        {!workspace ? (
          <div className="flex h-full flex-col items-center justify-center px-6 text-center">
            <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg border border-line bg-ink-850 text-mist-faint">
              <FolderOpen size={16} />
            </div>
            <div className="text-[11px] font-medium text-mist">No folder open</div>
            <p className="mt-1 text-[9.5px] leading-relaxed text-mist-faint">
              Open a workspace to browse files, use git badges and edit with Monaco.
            </p>
            <Button
              size="sm"
              variant="accent"
              className="mt-3"
              icon={<FolderOpen size={11} />}
              onClick={() => void openWorkspace()}
            >
              Open folder
            </Button>
          </div>
        ) : rootError ? (
          <div className="px-3 py-4">
            <p className="text-[10px] leading-relaxed text-coral-soft">{rootError}</p>
            <Button
              size="xs"
              variant="ghost"
              className="mt-2"
              onClick={() => workspace && void loadDir(normalizePath(workspace), true)}
            >
              Retry
            </Button>
          </div>
        ) : (
          <div className="pb-4">{renderNodes(normalizePath(workspace), 0)}</div>
        )}
      </div>

      {contextMenu && (
        <>
          <div
            className="fixed inset-0 z-[90]"
            onMouseDown={() => setContextMenu(null)}
            onContextMenu={(event) => {
              event.preventDefault();
              setContextMenu(null);
            }}
          />
          <div
            className="fixed z-[95] w-[198px] animate-slide-down overflow-hidden rounded-md border border-line-strong bg-ink-800 p-1 shadow-panel"
            style={{ left: contextMenu.x, top: contextMenu.y }}
          >
            <ContextItem
              icon={<FilePlus size={11} />}
              label="New file"
              onClick={() => {
                if (!workspace) return;
                const base =
                  contextMenu.node?.isDirectory
                    ? contextMenu.node.path
                    : contextMenu.node
                      ? dirname(contextMenu.node.path)
                      : normalizePath(workspace);
                openDialog('file', base);
              }}
            />
            <ContextItem
              icon={<FolderPlus size={11} />}
              label="New folder"
              onClick={() => {
                if (!workspace) return;
                const base =
                  contextMenu.node?.isDirectory
                    ? contextMenu.node.path
                    : contextMenu.node
                      ? dirname(contextMenu.node.path)
                      : normalizePath(workspace);
                openDialog('folder', base);
              }}
            />
            {contextMenu.node && (
              <>
                <div className="my-1 h-px bg-line" />
                <ContextItem
                  icon={<FilePlus size={11} />}
                  label="Rename"
                  onClick={() => {
                    const node = contextMenu.node!;
                    openDialog('rename', dirname(node.path), node.name, node.path);
                  }}
                />
                <ContextItem
                  icon={<Copy size={11} />}
                  label="Copy relative path"
                  onClick={() => copyRelative(contextMenu.node!)}
                />
                <ContextItem
                  icon={<ExternalLink size={11} />}
                  label="Reveal in file explorer"
                  onClick={() => {
                    him.app.showItemInFolder(contextMenu.node!.path);
                    setContextMenu(null);
                  }}
                />
                <div className="my-1 h-px bg-line" />
                <ContextItem
                  icon={<Trash2 size={11} />}
                  label="Move to recycle bin"
                  danger
                  onClick={() => {
                    const node = contextMenu.node!;
                    setDeleteTarget(node);
                    setContextMenu(null);
                  }}
                />
              </>
            )}
          </div>
        </>
      )}

      <Modal open={Boolean(dialog)} onClose={() => setDialog(null)} className="max-w-[420px]">
        <div className="p-5">
          <h3 className="text-[13px] font-semibold text-mist-bright">
            {dialog?.kind === 'rename'
              ? 'Rename entry'
              : dialog?.kind === 'folder'
                ? 'New folder'
                : 'New file'}
          </h3>
          <p className="mt-1 text-[9.5px] text-mist-faint">
            In {dialog ? relativeTo(workspace || '', dialog.baseDir) || '.' : ''}
          </p>
          <input
            ref={dialogInputRef}
            value={dialogName}
            onChange={(event) => {
              setDialogName(event.target.value);
              setDialogError(null);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                void submitDialog();
              }
            }}
            placeholder={dialog?.kind === 'folder' ? 'components' : 'new-file.ts'}
            spellCheck={false}
            className="him-input mt-3 h-8 font-mono text-[11px]"
          />
          {dialogError && <p className="mt-1.5 text-[10px] text-coral-soft">{dialogError}</p>}
          <div className="mt-4 flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setDialog(null)}>
              Cancel
            </Button>
            <Button
              size="sm"
              variant="primary"
              loading={busy}
              disabled={!dialogName.trim()}
              onClick={() => void submitDialog()}
            >
              {dialog?.kind === 'rename' ? 'Rename' : 'Create'}
            </Button>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Move to recycle bin?"
        message={
          deleteTarget
            ? `${deleteTarget.name} will be moved to the operating system recycle bin. Open editor tabs under it will close.`
            : ''
        }
        confirmLabel="Move to recycle bin"
        danger
        onConfirm={() => void confirmDelete()}
        onClose={() => setDeleteTarget(null)}
      />
    </div>
  );
}

function ContextItem({
  icon,
  label,
  danger,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  danger?: boolean;
  onClick(): void;
}) {
  return (
    <button
      onMouseDown={(event) => event.stopPropagation()}
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[10px] transition-colors',
        danger
          ? 'text-coral-soft hover:bg-coral-deep/40'
          : 'text-mist-dim hover:bg-ink-750 hover:text-mist-bright',
      )}
    >
      <span className={danger ? 'text-coral/80' : 'text-mist-ghost'}>{icon}</span>
      {label}
    </button>
  );
}
