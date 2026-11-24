import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent as ReactClipboardEvent,
  type DragEvent as ReactDragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import {
  AlertTriangle,
  Archive,
  ArrowUp,
  AtSign,
  Check,
  CornerDownLeft,
  FileImage,
  FileText,
  Folder,
  Map,
  Plug,
  Settings2,
  Square,
  Terminal,
  Trash2,
  X,
} from 'lucide-react';
import type { ChatAttachment } from '@shared/types';
import type { AgentSession } from '../../types';
import type { PermissionMode } from '../../types';
import { activeMentionQuery, findMentionTokens } from '../../lib/agent/context';
import { effectiveModelFor, isAgentRunning, sendPrompt, stopAgent } from '../../lib/agent/runtime';
import { dataUrlForAttachment, isImageFile, persistImageFile } from '../../lib/agent/attachments';
import { cyclePermission } from '../../lib/actions';
import { permissionMeta } from '../../lib/agent/prompts';
import { cleanErrorMessage, him } from '../../lib/bridge';
import { modelSupportsVision } from '../../lib/modelCaps';
import { extractImagePath } from '../../lib/imagePath';
import { attachmentFromSaved } from '../../lib/mediaDrop';
import { useAgentUiStore } from '../../store/agentUi';
import { useConfigStore, providerModelOptions } from '../../store/config';
import { useCoreStore } from '../../store/core';
import { useSessionStore } from '../../store/sessions';
import { toast } from '../../store/toast';
import { useClickOutside } from '../../lib/hooks';
import { cn, truncate } from '../../lib/utils';
import { Kbd, Spinner } from '../ui';
import { ModelMenu } from '../ModelMenu';
import { AcpModelMenu } from './AcpModelMenu';
import { PermissionSelect } from './PermissionSelect';

interface Suggestion {
  key: string;
  label: string;
  detail: string;
  insert: string;
  icon: typeof FileText;
  tone: string;
}

const slashCommands: Suggestion[] = [
  {
    key: 'plan',
    label: '/plan',
    detail: 'Read-only analysis and an implementation plan artifact',
    insert: '/plan ',
    icon: Map,
    tone: 'text-azure',
  },
  {
    key: 'compact',
    label: '/compact',
    detail: 'Summarize earlier turns locally to reclaim context',
    insert: '/compact',
    icon: Archive,
    tone: 'text-mist',
  },
  {
    key: 'clear',
    label: '/clear',
    detail: 'Clear the conversation timeline (does not revert files)',
    insert: '/clear',
    icon: Trash2,
    tone: 'text-coral',
  },
];

export interface ComposerSeed {
  text: string;
  nonce: number;
}

/** File objects from a paste or drop, falling back to clipboard items. */
function filesFromTransfer(data: DataTransfer | null): File[] {
  if (!data) return [];
  const files = Array.from(data.files || []);
  if (files.length > 0) return files;
  const fromItems: File[] = [];
  for (const item of Array.from(data.items || [])) {
    if (item.kind !== 'file') continue;
    const file = item.getAsFile();
    if (file) fromItems.push(file);
  }
  return fromItems;
}

function MediaChip({
  attachment,
  onRemove,
}: {
  attachment: ChatAttachment;
  onRemove(id: string): void;
}) {
  const [preview, setPreview] = useState<string | null>(null);
  const name = attachment.name || 'attachment';

  useEffect(() => {
    if (attachment.kind !== 'image') return;
    let active = true;
    void dataUrlForAttachment(attachment).then((url) => {
      if (active) setPreview(url);
    });
    return () => {
      active = false;
    };
  }, [attachment]);

  return (
    <span className="inline-flex max-w-[240px] items-center gap-1 rounded border border-line bg-ink-850/80 py-0.5 pl-0.5 pr-0.5 font-mono text-[8.5px] text-mist-faint">
      {preview ? (
        <img src={preview} alt="" className="h-6 w-6 shrink-0 rounded object-cover" />
      ) : (
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-ink-750 text-mist-ghost">
          {attachment.kind === 'image' ? <FileImage size={10} /> : <FileText size={10} />}
        </span>
      )}
      <span className="truncate">{name}</span>
      <button
        onClick={() => onRemove(attachment.id)}
        className="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded text-mist-ghost hover:bg-ink-750 hover:text-coral-soft"
        aria-label={`Remove ${name}`}
        title={`Remove ${name}`}
      >
        <X size={8} />
      </button>
    </span>
  );
}

export function AgentComposer({
  session,
  seed,
  compact = false,
}: {
  session: AgentSession;
  seed?: ComposerSeed | null;
  compact?: boolean;
}) {
  const workspaceFiles = useCoreStore((state) => state.workspaceFiles);
  const config = useConfigStore((state) => state.config);
  const setSettingsOpen = useCoreStore((state) => state.setSettingsOpen);
  const setPermission = useSessionStore((state) => state.setPermission);
  const pendingMedia = useAgentUiStore((state) => state.pendingMedia);
  const consumeMedia = useAgentUiStore((state) => state.consumeMedia);
  const [text, setText] = useState('');
  const [caret, setCaret] = useState(0);
  const [media, setMedia] = useState<ChatAttachment[]>([]);
  const [savingMedia, setSavingMedia] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [menuIndex, setMenuIndex] = useState(0);
  const [menuDismissed, setMenuDismissed] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const lastSessionRef = useRef(session.id);
  const sessionIdRef = useRef(session.id);
  const lastSeedRef = useRef(0);
  const isAcp = session.backend === 'acp';
  const acpProfile = isAcp
    ? config?.acpAgents.find((profile) => profile.id === session.acpProfileId)
    : null;
  const effectiveModel = isAcp ? null : effectiveModelFor(session);
  const enabledCount = providerModelOptions(config).length;
  const running = session.status === 'running' || session.status === 'waiting';

  const mentionQuery = activeMentionQuery(text, caret);
  const slashQuery =
    text.startsWith('/') && !text.slice(1).includes(' ') && !text.slice(1).includes('\n')
      ? text.slice(1)
      : null;

  const suggestions = useMemo<Suggestion[]>(() => {
    if (slashQuery !== null) {
      return slashCommands.filter((command) =>
        command.key.startsWith(slashQuery.toLowerCase()),
      );
    }
    if (mentionQuery === null) return [];
    const query = mentionQuery.toLowerCase();
    const items: Suggestion[] = [
      {
        key: 'terminal',
        label: 'terminal',
        detail: 'Attach the most recent terminal output',
        insert: '@terminal ',
        icon: Terminal,
        tone: 'text-mint',
      },
      {
        key: 'diff',
        label: 'diff',
        detail: 'Attach this session’s file changes',
        insert: '@diff ',
        icon: FileText,
        tone: 'text-sand',
      },
    ];

    const directories = new Set<string>();
    for (const file of workspaceFiles) {
      const parts = file.split('/');
      for (let i = 1; i < parts.length; i += 1) {
        directories.add(parts.slice(0, i).join('/'));
        if (directories.size > 80) break;
      }
      if (directories.size > 80) break;
    }
    const folderSuggestions = [...directories]
      .filter((directory) => !query || directory.toLowerCase().includes(query))
      .slice(0, 4)
      .map<Suggestion>((directory) => ({
        key: `folder:${directory}`,
        label: directory.split('/').pop() || directory,
        detail: `${directory}/`,
        insert: `@${directory.includes(' ') ? `"${directory}/"` : `${directory}/`} `,
        icon: Folder,
        tone: 'text-mist-faint',
      }));

    const fileSuggestions = workspaceFiles
      .filter((file) => !query || file.toLowerCase().includes(query))
      .sort((a, b) => {
        const aStarts = query && a.toLowerCase().startsWith(query) ? 1 : 0;
        const bStarts = query && b.toLowerCase().startsWith(query) ? 1 : 0;
        if (aStarts !== bStarts) return bStarts - aStarts;
        return a.length - b.length;
      })
      .slice(0, 7)
      .map<Suggestion>((file) => {
        const parts = file.split('/');
        const label = parts.pop() || file;
        return {
          key: `file:${file}`,
          label,
          detail: parts.join('/') || './',
          insert: `@${file.includes(' ') ? `"${file}"` : file} `,
          icon: FileText,
          tone: 'text-mist-dim',
        };
      });

    const specialMatches = items.filter(
      (item) => !query || item.label.toLowerCase().includes(query),
    );
    return [...specialMatches, ...folderSuggestions, ...fileSuggestions].slice(0, 10);
  }, [slashQuery, mentionQuery, workspaceFiles]);

  const menuMode = slashQuery !== null ? 'slash' : mentionQuery !== null ? 'mention' : null;
  const showMenu = Boolean(menuMode && suggestions.length > 0 && !menuDismissed);

  useClickOutside(wrapperRef, () => setMenuDismissed(true), showMenu);

  useEffect(() => {
    setMenuIndex(0);
    setMenuDismissed(false);
  }, [menuMode, mentionQuery, slashQuery]);

  useEffect(() => {
    sessionIdRef.current = session.id;
    if (lastSessionRef.current !== session.id) {
      lastSessionRef.current = session.id;
      setText('');
      setCaret(0);
      setMenuDismissed(true);
      setMedia([]);
      setSavingMedia(0);
      setDragging(false);
    }
  }, [session.id]);

  useEffect(() => {
    if (seed && seed.nonce !== lastSeedRef.current) {
      lastSeedRef.current = seed.nonce;
      setText(seed.text);
      setCaret(seed.text.length);
      setMenuDismissed(true);
      requestAnimationFrame(() => {
        const textarea = textareaRef.current;
        if (!textarea) return;
        textarea.focus();
        textarea.setSelectionRange(seed.text.length, seed.text.length);
      });
    }
  }, [seed]);

  // Images dropped or pasted anywhere in the app are queued here by mediaDrop.
  useEffect(() => {
    if (!pendingMedia) return;
    if (pendingMedia.sessionId && pendingMedia.sessionId !== session.id) return;
    setMedia((current) => {
      const known = new Set(current.map((item) => item.path || item.id));
      const fresh = pendingMedia.items.filter((item) => !known.has(item.path || item.id));
      return fresh.length > 0 ? [...current, ...fresh] : current;
    });
    consumeMedia();
  }, [pendingMedia, session.id, consumeMedia]);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(textarea.scrollHeight, compact ? 140 : 190)}px`;
  }, [text, compact]);

  const updateText = (next: string, nextCaret: number) => {
    setText(next);
    setCaret(nextCaret);
    setMenuDismissed(false);
  };

  const selectSuggestion = (suggestion: Suggestion) => {
    if (menuMode === 'slash') {
      const next = suggestion.insert.endsWith(' ') ? suggestion.insert : `${suggestion.insert} `;
      setText(next);
      setCaret(next.length);
      setMenuDismissed(true);
      requestAnimationFrame(() => {
        textareaRef.current?.focus();
        textareaRef.current?.setSelectionRange(next.length, next.length);
      });
      return;
    }
    const before = text.slice(0, caret);
    const atIndex = before.lastIndexOf('@');
    if (atIndex === -1) return;
    const next = `${text.slice(0, atIndex)}${suggestion.insert}${text.slice(caret)}`;
    const nextCaret = atIndex + suggestion.insert.length;
    setText(next);
    setCaret(nextCaret);
    setMenuDismissed(true);
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(nextCaret, nextCaret);
    });
  };

  const insertToken = (token: string) => {
    const textarea = textareaRef.current;
    const position = textarea?.selectionStart ?? caret;
    const next = `${text.slice(0, position)}${token}${text.slice(position)}`;
    setText(next);
    setCaret(position + token.length);
    setMenuDismissed(false);
    requestAnimationFrame(() => {
      textarea?.focus();
      textarea?.setSelectionRange(position + token.length, position + token.length);
    });
  };

  const removeMention = (raw: string, index: number) => {
    let end = index + raw.length;
    if (text[end] === ' ') end += 1;
    const next = `${text.slice(0, index)}${text.slice(end)}`;
    setText(next);
    setCaret(Math.max(0, index));
  };

  const addImageFiles = async (files: File[]) => {
    const images = files.filter(isImageFile);
    if (images.length === 0) return;
    const targetSession = session.id;
    setSavingMedia((count) => count + images.length);
    for (const file of images) {
      try {
        const attachment = await persistImageFile(file);
        if (sessionIdRef.current === targetSession) {
          setMedia((current) => [...current, attachment]);
        }
      } catch (error) {
        toast('error', cleanErrorMessage(error), 'Could not attach image');
      } finally {
        setSavingMedia((count) => Math.max(0, count - 1));
      }
    }
  };

  const removeMedia = (id: string) => {
    setMedia((current) => current.filter((attachment) => attachment.id !== id));
  };

  const handlePaste = (event: ReactClipboardEvent<HTMLTextAreaElement>) => {
    const images = filesFromTransfer(event.clipboardData).filter(isImageFile);
    if (images.length === 0) {
      // Ctrl+C in Explorer copies a file path; treat an image path as an attachment.
      const pastedText = event.clipboardData?.getData('text/plain') || '';
      const imagePath = extractImagePath(pastedText);
      if (imagePath) {
        event.preventDefault();
        void (async () => {
          try {
            if (!(await him.fs.exists(imagePath))) return;
            const saved = await him.attachments.importPaths([imagePath]);
            if (saved.length > 0) {
              const attachment = attachmentFromSaved(saved[0]);
              setMedia((current) => [...current, attachment]);
              toast('success', `Attached ${attachment.name}.`, 'Image attached');
            } else {
              toast('error', 'That file could not be imported as an image.', 'Attach failed');
            }
          } catch (error) {
            toast('error', cleanErrorMessage(error), 'Attach failed');
          }
        })();
      }
      return; // Normal text paste is untouched.
    }
    event.preventDefault();
    void addImageFiles(images);
  };

  const transferringFiles = (event: ReactDragEvent<HTMLDivElement>) =>
    Array.from(event.dataTransfer.types || []).includes('Files');

  const handleDragEnter = (event: ReactDragEvent<HTMLDivElement>) => {
    if (!transferringFiles(event)) return;
    event.preventDefault();
    setDragging(true);
  };

  const handleDragOver = (event: ReactDragEvent<HTMLDivElement>) => {
    if (!transferringFiles(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    if (!dragging) setDragging(true);
  };

  const handleDragLeave = (event: ReactDragEvent<HTMLDivElement>) => {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    setDragging(false);
  };

  const handleDrop = (event: ReactDragEvent<HTMLDivElement>) => {
    const files = filesFromTransfer(event.dataTransfer);
    if (files.length > 0) event.preventDefault();
    setDragging(false);
    void addImageFiles(files);
  };

  const submit = () => {
    const trimmed = text.trim();
    if (!trimmed && media.length === 0) return;
    const metaCommand = /^\/(clear|compact)\b/i.test(trimmed);
    if (!isAcp && !effectiveModel && !metaCommand) {
      setSettingsOpen(true);
      return;
    }
    const pending = media;
    setText('');
    setCaret(0);
    setMedia([]);
    void sendPrompt(session.id, trimmed, pending.length ? pending : undefined);
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Tab' && event.shiftKey) {
      event.preventDefault();
      setPermission(session.id, cyclePermission(session.permission) as PermissionMode);
      return;
    }
    if (showMenu) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setMenuIndex((index) => (index + 1) % suggestions.length);
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setMenuIndex((index) => (index - 1 + suggestions.length) % suggestions.length);
        return;
      }
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        selectSuggestion(suggestions[menuIndex]);
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        setMenuDismissed(true);
        return;
      }
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      if (event.nativeEvent.isComposing || event.keyCode === 229) return;
      event.preventDefault();
      submit();
      return;
    }
    if (event.key === 'Escape' && running) {
      event.preventDefault();
      stopAgent(session.id);
    }
  };

  const mentions = findMentionTokens(text);
  const visionUnsupported =
    media.length > 0 &&
    !isAcp &&
    effectiveModel !== null &&
    !modelSupportsVision(effectiveModel.model.id, effectiveModel.model.capabilities);
  const acpVisionUnsupported = media.length > 0 && isAcp && session.acpVision === false;
  const acpVisionUnknown = media.length > 0 && isAcp && session.acpVision == null;
  const menuTitle =
    menuMode === 'slash'
      ? 'Commands'
      : suggestions.some((suggestion) => suggestion.key.startsWith('file:'))
        ? 'Attach context'
        : 'Attach context';

  return (
    <div className={cn('shrink-0 px-4', compact ? 'pb-3 pt-2' : 'pb-4 pt-2')}>
      <div className={cn('mx-auto w-full', compact ? '' : 'max-w-[820px]')}>
        <div className="mb-1.5 flex min-w-0 items-center gap-2 px-0.5">
          <PermissionSelect session={session} compact={compact} />
          {!compact && (
            <span className="hidden min-w-0 flex-1 truncate text-[9px] text-mist-ghost sm:block">
              {permissionMeta[session.permission].description}
            </span>
          )}
          {!compact && (
            <span className="ml-auto shrink-0 items-center gap-1 text-[8.5px] text-mist-ghost sm:flex">
              <span>Cycle preset</span>
              <Kbd>Shift+Tab</Kbd>
            </span>
          )}
        </div>

        {!isAcp && !effectiveModel && enabledCount === 0 && (
          <button
            onClick={() => setSettingsOpen(true)}
            className="mb-1.5 flex w-full items-center gap-2 rounded-md border border-sand/25 bg-sand/[0.04] px-2.5 py-1.5 text-left text-[9.5px] text-sand-soft transition-colors hover:bg-sand/[0.07]"
          >
            <Settings2 size={11} />
            No enabled model. Connect a provider and enable a model to run this agent.
            <span className="ml-auto text-accent-soft">Open settings →</span>
          </button>
        )}

        <div
          ref={wrapperRef}
          onDragEnter={handleDragEnter}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={cn(
            'relative rounded-xl border border-line-strong bg-ink-800/85 shadow-panel transition-colors focus-within:border-accent/35',
            compact && 'rounded-lg',
            dragging && 'border-accent/50 bg-accent/[0.035]',
          )}
        >
          {showMenu && (
            <div className="absolute bottom-full left-2 right-2 z-[60] mb-1.5 animate-slide-up overflow-hidden rounded-lg border border-line-strong bg-ink-800 shadow-panel">
              <div className="flex items-center justify-between border-b border-line px-3 py-1.5">
                <span className="text-[8.5px] font-semibold uppercase tracking-[0.14em] text-mist-faint">
                  {menuTitle}
                </span>
                <span className="font-mono text-[8px] text-mist-ghost">
                  ↑↓ navigate · Enter select · Esc close
                </span>
              </div>
              <div className="thin-scrollbar max-h-[270px] overflow-y-auto p-1.5">
                {suggestions.map((suggestion, index) => {
                  const Icon = suggestion.icon;
                  const active = index === menuIndex;
                  return (
                    <button
                      key={suggestion.key}
                      onMouseDown={(event) => event.preventDefault()}
                      onMouseEnter={() => setMenuIndex(index)}
                      onClick={() => selectSuggestion(suggestion)}
                      className={cn(
                        'flex w-full items-center gap-2.5 rounded px-2 py-1.5 text-left',
                        active ? 'bg-ink-750' : 'hover:bg-ink-750/60',
                      )}
                    >
                      <Icon size={12} className={cn('shrink-0', suggestion.tone)} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-mono text-[10.5px] text-mist-bright">
                          {suggestion.label}
                        </span>
                        <span className="block truncate text-[8.5px] text-mist-ghost">
                          {suggestion.detail}
                        </span>
                      </span>
                      {active && <CornerDownLeft size={10} className="shrink-0 text-mist-ghost" />}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <textarea
            ref={textareaRef}
            value={text}
            rows={1}
            onChange={(event) => {
              const next = event.target.value;
              updateText(next, event.target.selectionStart ?? next.length);
            }}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            onKeyUp={(event) => {
              if (
                ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(
                  event.key,
                )
              ) {
                setCaret(event.currentTarget.selectionStart ?? 0);
              }
            }}
            onClick={(event) =>
              setCaret((event.target as HTMLTextAreaElement).selectionStart ?? 0)
            }
            placeholder={
              running
                ? 'Agent is working — Enter queues a follow-up, Esc stops'
                : isAcp
                  ? 'Direct the ACP agent… use @ for workspace context'
                  : 'Direct the agent… use @ for context, / for commands'
            }
            spellCheck={false}
            className={cn(
              'him-textarea block w-full border-0 bg-transparent px-3.5 pt-2.5 text-[12px] leading-relaxed text-mist-bright outline-none placeholder:text-mist-ghost focus:ring-0',
              compact ? 'min-h-[38px] text-[11.5px]' : 'min-h-[54px]',
            )}
          />

          {(media.length > 0 || savingMedia > 0) && (
            <div className="flex flex-wrap items-center gap-1 px-3 pb-1.5">
              {media.map((attachment) => (
                <MediaChip
                  key={attachment.id}
                  attachment={attachment}
                  onRemove={removeMedia}
                />
              ))}
              {savingMedia > 0 && (
                <span className="inline-flex items-center gap-1 rounded border border-line bg-ink-850/60 px-1.5 py-0.5 font-mono text-[8.5px] text-mist-ghost">
                  <Spinner size={8} />
                  {savingMedia > 1 ? `Saving ${savingMedia} images…` : 'Saving image…'}
                </span>
              )}
              {visionUnsupported && (
                <span className="flex w-full items-start gap-1 text-[9px] leading-relaxed text-sand-soft">
                  <AlertTriangle size={9} className="mt-0.5 shrink-0" />
                  This model may not accept images — they will be sent as text-only context.
                </span>
              )}
              {acpVisionUnsupported && (
                <span className="flex w-full items-start gap-1 text-[9px] leading-relaxed text-sand-soft">
                  <AlertTriangle size={9} className="mt-0.5 shrink-0" />
                  This ACP agent does not advertise image input, so screenshots cannot be
                  delivered. Use a HIM+ agent session (or an image-capable ACP agent) for vision.
                </span>
              )}
              {acpVisionUnknown && (
                <span className="flex w-full items-start gap-1 text-[9px] leading-relaxed text-mist-faint">
                  <Spinner size={8} />
                  Checking whether this ACP agent accepts images…
                </span>
              )}
            </div>
          )}

          {mentions.length > 0 && (
            <div className="flex flex-wrap gap-1 px-3 pb-1.5">
              {mentions.map((mention) => (
                <span
                  key={`${mention.raw}-${mention.index}`}
                  className="inline-flex max-w-[240px] items-center gap-1 rounded border border-line bg-ink-850/80 py-0.5 pl-1.5 pr-0.5 font-mono text-[8.5px] text-mist-faint"
                >
                  <AtSign size={8} className="text-accent-dim" />
                  <span className="truncate">{mention.target}</span>
                  <button
                    onClick={() => removeMention(mention.raw, mention.index)}
                    className="flex h-3.5 w-3.5 items-center justify-center rounded text-mist-ghost hover:bg-ink-750 hover:text-coral-soft"
                    aria-label={`Remove ${mention.target} context`}
                  >
                    <X size={8} />
                  </button>
                </span>
              ))}
            </div>
          )}

          <div className="flex items-center gap-0.5 px-2 pb-2">
            <button
              onClick={() => insertToken('@')}
              className="flex h-6 w-6 items-center justify-center rounded text-mist-faint transition-colors hover:bg-ink-750 hover:text-mist"
              title="Attach file, folder, terminal or diff context (@)"
              aria-label="Attach context"
            >
              <AtSign size={13} />
            </button>
            <button
              onClick={() => insertToken('/')}
              className="flex h-6 w-6 items-center justify-center rounded font-mono text-[12px] text-mist-faint transition-colors hover:bg-ink-750 hover:text-mist"
              title="Slash commands (/)"
              aria-label="Slash command"
            >
              /
            </button>
            <div className="mx-1 h-3 w-px bg-line" />
            {isAcp ? (
              <>
                <span
                  className="flex min-w-0 items-center gap-1 rounded border border-accent/20 bg-accent/[0.05] px-1.5 py-0.5 font-mono text-[8.5px] text-accent-soft"
                  title={acpProfile ? `${acpProfile.command} ${acpProfile.args.join(' ')}` : ''}
                >
                  <Plug size={9} className="shrink-0" />
                  <span className="truncate">
                    ACP · {acpProfile?.name || 'profile missing'}
                  </span>
                </span>
                <AcpModelMenu session={session} compact={compact} />
              </>
            ) : (
              <>
                <ModelMenu placement="up" compact={compact} />
                {!compact && (
                  <span className="ml-1 hidden font-mono text-[8px] text-mist-ghost lg:inline">
                    {effectiveModel ? effectiveModel.provider.name : 'no provider'}
                  </span>
                )}
              </>
            )}
            <div className="flex-1" />
            {running ? (
              <button
                onClick={() => stopAgent(session.id)}
                className="flex h-7 w-7 items-center justify-center rounded-md border border-coral/30 bg-coral-deep/40 text-coral-soft transition-colors hover:bg-coral-deep/70"
                title="Stop agent (Esc)"
                aria-label="Stop agent"
              >
                <Square size={10} fill="currentColor" />
              </button>
            ) : (
              <button
                onClick={submit}
                disabled={!text.trim() && media.length === 0}
                className={cn(
                  'flex h-7 w-7 items-center justify-center rounded-md transition-all',
                  text.trim() || media.length > 0
                    ? 'bg-accent text-ink-950 glow-accent hover:bg-accent-soft'
                    : 'cursor-default bg-ink-700 text-mist-ghost',
                )}
                title="Send (Enter)"
                aria-label="Send message"
              >
                <ArrowUp size={13} />
              </button>
            )}
          </div>
        </div>
        {!compact && (
          <div className="mt-1.5 flex items-center gap-3 px-1 font-mono text-[8px] text-mist-ghost">
            <span>Enter to send · Shift+Enter for newline</span>
            {running && (
              <span className="flex items-center gap-1 text-accent/70">
                <Spinner size={8} /> streaming
              </span>
            )}
            {!running && session.messages.length > 0 && (
              <span className="ml-auto flex items-center gap-1">
                <Check size={8} className="text-mint" /> {truncate(session.title, 32)}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
