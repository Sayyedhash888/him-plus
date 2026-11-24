import { useEffect, useState } from 'react';
import { FolderOpen, Maximize2, Minus, Plus } from 'lucide-react';
import { him } from '../../lib/bridge';
import { cn } from '../../lib/utils';

const CHECKERBOARD: React.CSSProperties = {
  backgroundColor: '#0a0a0a',
  backgroundImage:
    'linear-gradient(45deg, rgba(255,255,255,0.045) 25%, transparent 25%), linear-gradient(-45deg, rgba(255,255,255,0.045) 25%, transparent 25%), linear-gradient(45deg, transparent 75%, rgba(255,255,255,0.045) 75%), linear-gradient(-45deg, transparent 75%, rgba(255,255,255,0.045) 75%)',
  backgroundSize: '20px 20px',
  backgroundPosition: '0 0, 0 10px, 10px -10px, -10px 0px',
};

/** In-app preview for raster images opened from the explorer or quick open. */
export function ImageViewer({
  dataUrl,
  name,
  path,
}: {
  dataUrl?: string;
  name: string;
  path: string;
}) {
  const [zoom, setZoom] = useState(1);
  const [fit, setFit] = useState(true);
  const [dimensions, setDimensions] = useState<{ width: number; height: number } | null>(null);

  useEffect(() => {
    setZoom(1);
    setFit(true);
    setDimensions(null);
  }, [dataUrl]);

  if (!dataUrl) {
    return (
      <div className="flex h-full items-center justify-center bg-ink-950 text-[10px] text-mist-faint">
        Loading image…
      </div>
    );
  }

  const changeZoom = (next: number) => {
    setFit(false);
    setZoom(Math.min(8, Math.max(0.1, next)));
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-ink-950">
      <div className="flex h-8 shrink-0 items-center gap-2 border-b border-line bg-ink-900/60 px-2.5">
        <Maximize2 size={10} className="shrink-0 text-accent-dim" />
        <span className="shrink-0 text-[9px] uppercase tracking-[0.1em] text-mist-ghost">
          Image
        </span>
        <span className="min-w-0 truncate font-mono text-[9.5px] text-mist-dim">{name}</span>
        {dimensions && (
          <span className="shrink-0 font-mono text-[8.5px] text-mist-ghost">
            {dimensions.width} × {dimensions.height}
          </span>
        )}
        <div className="ml-auto flex shrink-0 items-center gap-0.5">
          <button
            onClick={() => changeZoom((fit ? 1 : zoom) / 1.25)}
            className="flex h-5 w-5 items-center justify-center rounded text-mist-faint hover:bg-ink-750 hover:text-mist"
            title="Zoom out"
            aria-label="Zoom out"
          >
            <Minus size={10} />
          </button>
          <span className="w-11 text-center font-mono text-[8.5px] text-mist-faint">
            {fit ? 'Fit' : `${Math.round(zoom * 100)}%`}
          </span>
          <button
            onClick={() => changeZoom((fit ? 1 : zoom) * 1.25)}
            className="flex h-5 w-5 items-center justify-center rounded text-mist-faint hover:bg-ink-750 hover:text-mist"
            title="Zoom in"
            aria-label="Zoom in"
          >
            <Plus size={10} />
          </button>
          <button
            onClick={() => {
              setFit(true);
              setZoom(1);
            }}
            className={cn(
              'ml-1 flex h-5 items-center rounded border px-1.5 text-[8.5px]',
              fit
                ? 'border-accent/25 bg-accent/[0.06] text-accent-soft'
                : 'border-line text-mist-faint hover:text-mist',
            )}
            title="Fit to window"
          >
            Fit
          </button>
          <button
            onClick={() => changeZoom(1)}
            className="flex h-5 items-center rounded border border-line px-1.5 text-[8.5px] text-mist-faint hover:text-mist"
            title="Actual size (100%)"
          >
            100%
          </button>
          <button
            onClick={() => him.app.showItemInFolder(path)}
            className="ml-1 flex h-5 w-5 items-center justify-center rounded text-mist-faint hover:bg-ink-750 hover:text-mist"
            title="Reveal in file explorer"
            aria-label="Reveal in file explorer"
          >
            <FolderOpen size={10} />
          </button>
        </div>
      </div>
      <div className="thin-scrollbar min-h-0 flex-1 overflow-auto" style={CHECKERBOARD}>
        <div className="flex min-h-full min-w-full items-center justify-center p-6">
          <img
            src={dataUrl}
            alt={name}
            draggable={false}
            onLoad={(event) =>
              setDimensions({
                width: event.currentTarget.naturalWidth,
                height: event.currentTarget.naturalHeight,
              })
            }
            style={
              fit
                ? { maxWidth: '100%', maxHeight: '100%' }
                : {
                    width: dimensions ? `${Math.round(dimensions.width * zoom)}px` : undefined,
                    maxWidth: 'none',
                    imageRendering: zoom >= 2 ? 'pixelated' : 'auto',
                  }
            }
            className="select-none shadow-panel"
          />
        </div>
      </div>
    </div>
  );
}
