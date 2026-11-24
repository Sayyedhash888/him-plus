import markUrl from '../assets/brand/him-mark.svg';
import logoUrl from '../assets/brand/him-logo.svg';

export { markUrl, logoUrl };

export function BrandMark({
  size = 24,
  className,
  alt = 'HIM+',
}: {
  size?: number;
  className?: string;
  alt?: string;
}) {
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center ${className || ''}`}
      style={{
        width: size,
        height: size,
        filter: 'drop-shadow(0 1px 2px rgba(0, 0, 0, 0.38))',
      }}
    >
      <img
        src={markUrl}
        alt={alt}
        draggable={false}
        className="block h-full w-full select-none"
      />
    </span>
  );
}

export function BrandWordmark({
  className,
  tagline,
}: {
  className?: string;
  tagline?: boolean;
}) {
  return (
    <span className={`flex flex-col select-none ${className || ''}`}>
      <span className="font-sans font-black leading-none tracking-[-0.055em] text-mist-bright">
        HIM<span className="font-black text-mist-faint">+</span>
      </span>
      {tagline && (
        <span className="mt-1 font-mono text-[7.5px] font-semibold uppercase leading-none tracking-[0.22em] text-mist-faint">
          Integrated development environment
        </span>
      )}
    </span>
  );
}

export function BrandLockup({
  size = 26,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <span className={`inline-flex items-center gap-2.5 select-none ${className || ''}`}>
      <BrandMark size={size} alt="" />
      <BrandWordmark className="text-[13.5px]" />
    </span>
  );
}

export function BrandBanner({ className }: { className?: string }) {
  return (
    <img
      src={logoUrl}
      alt="HIM+ — Integrated Development Environment"
      draggable={false}
      className={`block h-auto select-none ${className || ''}`}
    />
  );
}