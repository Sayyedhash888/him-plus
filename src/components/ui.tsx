import React, {
  forwardRef,
  useEffect,
  useMemo,
  useState,
  type ButtonHTMLAttributes,
  type ReactNode,
} from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Copy,
  Info,
  Loader2,
  X,
} from 'lucide-react';
import { cn } from '../lib/utils';
import { him } from '../lib/bridge';
import { useToastStore } from '../store/toast';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'accent' | 'outline';
type ButtonSize = 'xs' | 'sm' | 'md';

const buttonVariants: Record<ButtonVariant, string> = {
  primary:
    'bg-accent text-ink-950 border border-accent/70 hover:bg-accent-soft hover:border-accent-soft glow-accent-strong',
  secondary:
    'bg-ink-750 text-mist-bright border border-line-strong hover:bg-ink-700 hover:border-mist-ghost shadow-inset',
  ghost:
    'text-mist-dim border border-transparent hover:text-mist-bright hover:bg-ink-750/80',
  danger:
    'text-coral-soft border border-coral/30 bg-coral-deep/40 hover:bg-coral-deep/70 hover:border-coral/50',
  accent:
    'text-accent-soft border border-accent/25 bg-accent/10 hover:bg-accent/15 hover:border-accent/40',
  outline:
    'text-mist border border-line hover:text-mist-bright hover:border-line-strong hover:bg-ink-800',
};

const buttonSizes: Record<ButtonSize, string> = {
  xs: 'h-6 px-2 text-[11px] gap-1.5 rounded-[5px]',
  sm: 'h-7 px-2.5 text-[11.5px] gap-1.5 rounded-md',
  md: 'h-8 px-3 text-xs gap-2 rounded-md',
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', loading, icon, className, children, disabled, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      className={cn(
        'inline-flex select-none items-center justify-center whitespace-nowrap font-medium transition-colors duration-100 disabled:opacity-45',
        buttonVariants[variant],
        buttonSizes[size],
        className,
      )}
      disabled={disabled || loading}
      {...rest}
    >
      {loading ? <Loader2 size={13} className="animate-spin" /> : icon}
      {children}
    </button>
  );
});

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  size?: 'xs' | 'sm' | 'md';
  active?: boolean;
  tone?: 'default' | 'danger' | 'accent';
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, size = 'sm', active, tone = 'default', className, children, ...rest },
  ref,
) {
  const sizes = {
    xs: 'h-6 w-6 rounded-[5px]',
    sm: 'h-7 w-7 rounded-md',
    md: 'h-8 w-8 rounded-md',
  };
  return (
    <button
      ref={ref}
      aria-label={label}
      title={label}
      className={cn(
        'inline-flex shrink-0 select-none items-center justify-center border border-transparent text-mist-faint transition-colors duration-100 hover:bg-ink-750/80 hover:text-mist-bright disabled:opacity-40',
        sizes[size],
        active && 'bg-ink-750 text-mist-bright border-line',
        tone === 'danger' && 'hover:bg-coral-deep/50 hover:text-coral-soft',
        tone === 'accent' && 'hover:bg-accent/10 hover:text-accent-soft',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
});

export function Spinner({ size = 13, className }: { size?: number; className?: string }) {
  return <Loader2 size={size} className={cn('animate-spin text-mist-faint', className)} />;
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd>{children}</kbd>;
}

export function SectionLabel({
  children,
  className,
  trailing,
}: {
  children: ReactNode;
  className?: string;
  trailing?: ReactNode;
}) {
  return (
    <div className={cn('flex items-center gap-2', className)}>
      <span className="text-[9.5px] font-semibold uppercase tracking-[0.16em] text-mist-faint">
        {children}
      </span>
      {trailing}
    </div>
  );
}

type Tone = 'accent' | 'mint' | 'coral' | 'sand' | 'muted' | 'azure';

const toneClasses: Record<Tone, string> = {
  accent: 'bg-accent glow-accent',
  mint: 'bg-mint glow-mint',
  coral: 'bg-coral glow-coral',
  sand: 'bg-sand glow-sand',
  muted: 'bg-mist-ghost',
  azure: 'bg-azure glow-azure',
};

export function StatusDot({
  tone = 'muted',
  pulse = false,
  className,
}: {
  tone?: Tone;
  pulse?: boolean;
  className?: string;
}) {
  return (
    <span className={cn('relative inline-flex h-1.5 w-1.5 shrink-0', className)}>
      {pulse && (
        <span
          className={cn(
            'absolute inline-flex h-full w-full animate-ping rounded-full opacity-60',
            toneClasses[tone],
          )}
        />
      )}
      <span className={cn('relative inline-flex h-1.5 w-1.5 rounded-full', toneClasses[tone])} />
    </span>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange(value: boolean): void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-[18px] w-[32px] shrink-0 items-center rounded-full border transition-colors duration-150 disabled:opacity-40',
        checked
          ? 'border-accent/50 bg-accent/25'
          : 'border-line-strong bg-ink-700 hover:border-mist-ghost',
      )}
    >
      <span
        className={cn(
          'ml-[3px] h-3 w-3 rounded-full transition-all duration-150',
          checked
            ? 'translate-x-[13px] bg-accent glow-accent'
            : 'bg-mist-faint',
        )}
      />
    </button>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  size = 'md',
  className,
}: {
  value: T;
  options: { value: T; label: ReactNode; count?: number }[];
  onChange(value: T): void;
  size?: 'sm' | 'md';
  className?: string;
}) {
  return (
    <div
      className={cn(
        'inline-flex items-center rounded-md border border-line bg-ink-850/90 p-0.5',
        className,
      )}
      role="tablist"
    >
      {options.map((option) => {
        const active = value === option.value;
        return (
          <button
            key={option.value}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(option.value)}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-[4px] font-medium transition-colors duration-100',
              size === 'sm' ? 'h-5 px-2 text-[10px]' : 'h-6 px-2.5 text-[11px]',
              active
                ? 'bg-ink-700 text-mist-bright shadow-inset'
                : 'text-mist-faint hover:text-mist',
            )}
          >
            {option.label}
            {option.count !== undefined && option.count > 0 && (
              <span
                className={cn(
                  'font-mono text-[9px] tabular-nums',
                  active ? 'text-accent' : 'text-mist-ghost',
                )}
              >
                {option.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export function Modal({
  open,
  onClose,
  children,
  className,
  labelledBy,
  closeOnEscape = true,
  wide,
}: {
  open: boolean;
  onClose(): void;
  children: ReactNode;
  className?: string;
  labelledBy?: string;
  closeOnEscape?: boolean;
  wide?: boolean;
}) {
  useEffect(() => {
    if (!open || !closeOnEscape) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, closeOnEscape, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-6">
      <div
        className="modal-scrim absolute inset-0 animate-fade-in backdrop-blur-[3px]"
        onMouseDown={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        className={cn(
          'relative z-10 flex max-h-[90vh] animate-slide-up flex-col overflow-hidden rounded-xl border border-line-strong bg-ink-800 shadow-panel',
          wide ? 'h-[680px] w-full max-w-[980px]' : 'w-full max-w-[520px]',
          className,
        )}
      >
        {children}
      </div>
    </div>
  );
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  danger,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm(): void;
  onClose(): void;
}) {
  return (
    <Modal open={open} onClose={onClose} className="max-w-[440px]">
      <div className="p-5">
        <h2 className="text-[13px] font-semibold text-mist-bright">{title}</h2>
        <p className="mt-2 text-[12px] leading-relaxed text-mist-dim">{message}</p>
        <div className="mt-5 flex justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            size="sm"
            variant={danger ? 'danger' : 'primary'}
            onClick={() => {
              onConfirm();
              onClose();
            }}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

export function Tooltip({
  label,
  shortcut,
  children,
  side = 'bottom',
  className,
}: {
  label: string;
  shortcut?: string;
  children: ReactNode;
  side?: 'top' | 'bottom' | 'left' | 'right';
  className?: string;
}) {
  const position = {
    top: 'bottom-full left-1/2 -translate-x-1/2 mb-1.5',
    bottom: 'top-full left-1/2 -translate-x-1/2 mt-1.5',
    left: 'right-full top-1/2 -translate-y-1/2 mr-1.5',
    right: 'left-full top-1/2 -translate-y-1/2 ml-1.5',
  }[side];
  return (
    <span className={cn('group/tip relative inline-flex', className)}>
      {children}
      <span
        className={cn(
          'pointer-events-none absolute z-[130] flex items-center gap-1.5 whitespace-nowrap rounded-md border border-line-strong bg-ink-750 px-2 py-1 text-[10.5px] font-medium text-mist opacity-0 shadow-panel transition-opacity delay-300 duration-100 group-hover/tip:opacity-100',
          position,
        )}
      >
        {label}
        {shortcut && <span className="font-mono text-[9px] text-mist-faint">{shortcut}</span>}
      </span>
    </span>
  );
}

function CodeBlock({
  code,
  language,
  onApply,
}: {
  code: string;
  language: string;
  onApply?: (code: string) => void;
}) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      // clipboard can be unavailable
    }
  };
  return (
    <div className="my-2 overflow-hidden rounded-md border border-line bg-ink-950/65">
      <div className="flex h-7 items-center justify-between border-b border-line/80 bg-ink-850/60 px-2.5">
        <span className="font-mono text-[9.5px] uppercase tracking-[0.12em] text-mist-faint">
          {language || 'code'}
        </span>
        <div className="flex items-center gap-1">
          {onApply && (
            <button
              onClick={() => onApply(code)}
              className="inline-flex h-5 items-center gap-1 rounded px-1.5 text-[9.5px] font-medium text-accent-soft transition-colors hover:bg-accent/10"
            >
              Apply
            </button>
          )}
          <button
            onClick={copy}
            className="inline-flex h-5 items-center gap-1 rounded px-1.5 text-[9.5px] text-mist-faint transition-colors hover:bg-ink-750 hover:text-mist"
          >
            {copied ? <Check size={10} className="text-mint" /> : <Copy size={10} />}
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
      </div>
      <pre className="thin-scrollbar max-h-[360px] overflow-auto p-3 text-[11.5px] leading-[1.7] text-mist">
        <code className="font-mono">{code}</code>
      </pre>
    </div>
  );
}

export function MarkdownView({
  content,
  onApplyCode,
  className,
}: {
  content: string;
  onApplyCode?: (code: string) => void;
  className?: string;
}) {
  const components = useMemo(
    () => ({
      pre({ children }: { children?: ReactNode }) {
        const array = React.Children.toArray(children);
        const first = array[0];
        if (React.isValidElement(first)) {
          const props = first.props as { className?: string; children?: ReactNode };
          const raw = String(props.children ?? '').replace(/\s+$/, '');
          const language = /language-([\w+-]+)/.exec(props.className || '')?.[1] || '';
          return <CodeBlock code={raw} language={language} onApply={onApplyCode} />;
        }
        return <pre>{children}</pre>;
      },
      code({ className: codeClassName, children }: { className?: string; children?: ReactNode }) {
        return <code className={codeClassName}>{children}</code>;
      },
      a({ href, children }: { href?: string; children?: ReactNode }) {
        return (
          <a
            href={href}
            onClick={(event) => {
              event.preventDefault();
              if (href && /^https?:/i.test(href)) void him.app.openExternal(href);
            }}
          >
            {children}
          </a>
        );
      },
    }),
    [onApplyCode],
  );
  return (
    <div className={cn('md-body', className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  );
}

export function Toasts() {
  const toasts = useToastStore((state) => state.toasts);
  const dismiss = useToastStore((state) => state.dismiss);
  return (
    <div className="pointer-events-none fixed bottom-9 right-4 z-[140] flex w-[340px] flex-col gap-2">
      {toasts.map((toastItem) => {
        const tone =
          toastItem.kind === 'error'
            ? { icon: AlertTriangle, color: 'text-coral', edge: 'border-coral/25' }
            : toastItem.kind === 'success'
              ? { icon: CheckCircle2, color: 'text-mint', edge: 'border-mint/20' }
              : { icon: Info, color: 'text-accent', edge: 'border-accent/20' };
        const Icon = tone.icon;
        return (
          <div
            key={toastItem.id}
            className={cn(
              'pointer-events-auto flex animate-slide-up items-start gap-2.5 rounded-lg border bg-ink-750/95 p-3 shadow-panel backdrop-blur',
              tone.edge,
            )}
          >
            <Icon size={14} className={cn('mt-0.5 shrink-0', tone.color)} />
            <div className="min-w-0 flex-1">
              {toastItem.title && (
                <div className="text-[11.5px] font-semibold text-mist-bright">
                  {toastItem.title}
                </div>
              )}
              <div className="break-word text-[11px] leading-relaxed text-mist-dim">
                {toastItem.message}
              </div>
            </div>
            <button
              onClick={() => dismiss(toastItem.id)}
              className="mt-0.5 text-mist-ghost transition-colors hover:text-mist"
              aria-label="Dismiss notification"
            >
              <X size={12} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
