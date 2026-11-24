import { useEffect, useState } from 'react';
import { FileImage, FileText } from 'lucide-react';
import type { ChatAttachment } from '@shared/types';
import { dataUrlForAttachment } from '../../lib/agent/attachments';
import { cn, truncate } from '../../lib/utils';

/**
 * Renders the images and files persisted with a chat turn.
 *
 * Data URLs are resolved through the shared attachment cache in
 * `lib/agent/attachments`, so re-mounting the timeline does not re-read disk.
 * Non-image attachments and images whose bytes cannot be found degrade to a
 * muted chip instead of an empty box.
 */
export function MediaGallery({
  media,
  compact = false,
  className,
}: {
  media: ChatAttachment[];
  compact?: boolean;
  className?: string;
}) {
  const [urls, setUrls] = useState<Record<string, string | null>>({});

  useEffect(() => {
    if (media.length === 0) {
      setUrls({});
      return;
    }
    let active = true;
    void Promise.all(
      media.map(async (attachment) => {
        const url =
          attachment.kind === 'image' ? await dataUrlForAttachment(attachment) : null;
        return [attachment.id, url] as const;
      }),
    ).then((entries) => {
      if (active) setUrls(Object.fromEntries(entries));
    });
    return () => {
      active = false;
    };
  }, [media]);

  if (media.length === 0) return null;

  return (
    <div className={cn('flex flex-wrap items-start gap-1.5', className)}>
      {media.map((attachment) => {
        const name = attachment.name || (attachment.kind === 'image' ? 'image' : 'file');
        const url = attachment.kind === 'image' ? urls[attachment.id] : null;
        const missing = attachment.kind === 'image' && urls[attachment.id] === null;

        if (url) {
          return (
            <figure key={attachment.id} className="min-w-0">
              <img
                src={url}
                alt={name}
                title={name}
                className={cn(
                  'block rounded border border-line bg-ink-850 object-cover',
                  compact ? 'h-6 w-6' : 'max-h-40 w-auto max-w-[240px] shadow-inset',
                )}
              />
              {!compact && (
                <figcaption className="mt-0.5 max-w-[180px] truncate font-mono text-[8.5px] text-mist-ghost">
                  {name}
                </figcaption>
              )}
            </figure>
          );
        }

        if (missing) {
          return (
            <span
              key={attachment.id}
              title={name}
              className="inline-flex max-w-[220px] items-center gap-1 rounded border border-line bg-ink-850/60 px-1.5 py-0.5 font-mono text-[8.5px] text-mist-ghost"
            >
              <FileImage size={9} className="shrink-0" />
              <span className="truncate">{truncate(name, compact ? 14 : 30)}</span>
            </span>
          );
        }

        if (attachment.kind !== 'image') {
          return (
            <span
              key={attachment.id}
              title={name}
              className="inline-flex max-w-[220px] items-center gap-1 rounded border border-line bg-ink-850/60 px-1.5 py-0.5 font-mono text-[8.5px] text-mist-faint"
            >
              <FileText size={9} className="shrink-0" />
              <span className="truncate">{truncate(name, compact ? 14 : 30)}</span>
            </span>
          );
        }

        // Image whose data URL is still loading.
        return (
          <span
            key={attachment.id}
            title={name}
            className={cn(
              'flex items-center justify-center rounded border border-line bg-ink-850/60 text-mist-ghost',
              compact ? 'h-6 w-6' : 'h-14 w-20',
            )}
          >
            <FileImage size={compact ? 9 : 12} />
          </span>
        );
      })}
    </div>
  );
}
