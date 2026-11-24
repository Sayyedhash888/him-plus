import {
  Braces,
  File,
  FileCode2,
  FileCog,
  FileJson,
  FileImage,
  FileKey,
  FileLock2,
  FileText,
  Folder,
  FolderOpen,
  type LucideIcon,
} from 'lucide-react';
import { cn, fileExtension } from '../lib/utils';

/** Official Jupyter mark (simple-icons), coloured with the Jupyter orange. */
function JupyterIcon({
  size,
  className,
}: {
  size: number;
  className?: string;
}) {
  return (
    <svg
      role="img"
      aria-label="Jupyter notebook"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={cn('shrink-0 text-[#f37626]', className)}
      fill="currentColor"
    >
      <path d="M7.157 22.201A1.784 1.799 0 0 1 5.374 24a1.784 1.799 0 0 1-1.784-1.799 1.784 1.799 0 0 1 1.784-1.799 1.784 1.799 0 0 1 1.783 1.799zM20.582 1.427a1.415 1.427 0 0 1-1.415 1.428 1.415 1.427 0 0 1-1.416-1.428A1.415 1.427 0 0 1 19.167 0a1.415 1.427 0 0 1 1.415 1.427zM4.992 3.336A1.047 1.056 0 0 1 3.946 4.39a1.047 1.056 0 0 1-1.047-1.055A1.047 1.056 0 0 1 3.946 2.28a1.047 1.056 0 0 1 1.046 1.056zm7.336 1.517c3.769 0 7.06 1.38 8.768 3.424a9.363 9.363 0 0 0-3.393-4.547 9.238 9.238 0 0 0-5.377-1.728A9.238 9.238 0 0 0 6.95 3.73a9.363 9.363 0 0 0-3.394 4.547c1.713-2.04 5.004-3.424 8.772-3.424zm.001 13.295c-3.768 0-7.06-1.381-8.768-3.425a9.363 9.363 0 0 0 3.394 4.547A9.238 9.238 0 0 0 12.33 21a9.238 9.238 0 0 0 5.377-1.729 9.363 9.363 0 0 0 3.393-4.547c-1.712 2.044-5.003 3.425-8.772 3.425Z" />
    </svg>
  );
}

interface IconSpec {
  icon: LucideIcon;
  className: string;
}

const byExtension: Record<string, IconSpec> = {
  ts: { icon: FileCode2, className: 'text-azure' },
  tsx: { icon: FileCode2, className: 'text-azure' },
  js: { icon: FileCode2, className: 'text-sand' },
  jsx: { icon: FileCode2, className: 'text-sand' },
  mjs: { icon: FileCode2, className: 'text-sand' },
  cjs: { icon: FileCode2, className: 'text-sand' },
  json: { icon: FileJson, className: 'text-sand' },
  jsonc: { icon: FileJson, className: 'text-sand' },
  css: { icon: Braces, className: 'text-accent' },
  scss: { icon: Braces, className: 'text-accent' },
  less: { icon: Braces, className: 'text-accent' },
  html: { icon: FileCode2, className: 'text-coral-soft' },
  md: { icon: FileText, className: 'text-mist' },
  mdx: { icon: FileText, className: 'text-mist' },
  yml: { icon: FileCog, className: 'text-mint' },
  yaml: { icon: FileCog, className: 'text-mint' },
  toml: { icon: FileCog, className: 'text-mint' },
  sh: { icon: FileCode2, className: 'text-mint' },
  bash: { icon: FileCode2, className: 'text-mint' },
  ps1: { icon: FileCode2, className: 'text-azure' },
  py: { icon: FileCode2, className: 'text-azure' },
  rs: { icon: FileCode2, className: 'text-coral-soft' },
  go: { icon: FileCode2, className: 'text-accent' },
  svg: { icon: FileImage, className: 'text-sand' },
  png: { icon: FileImage, className: 'text-sand' },
  jpg: { icon: FileImage, className: 'text-sand' },
  jpeg: { icon: FileImage, className: 'text-sand' },
  webp: { icon: FileImage, className: 'text-sand' },
  ico: { icon: FileImage, className: 'text-sand' },
  env: { icon: FileKey, className: 'text-sand' },
  gitignore: { icon: FileLock2, className: 'text-mist-faint' },
};

export function FileTypeIcon({
  name,
  isDirectory,
  expanded,
  size = 14,
  className,
}: {
  name: string;
  isDirectory?: boolean;
  expanded?: boolean;
  size?: number;
  className?: string;
}) {
  if (isDirectory) {
    const Icon = expanded ? FolderOpen : Folder;
    return (
      <Icon
        size={size}
        className={cn('shrink-0', expanded ? 'text-accent-dim' : 'text-mist-faint', className)}
        strokeWidth={1.75}
      />
    );
  }
  const extension = fileExtension(name);
  if (extension === 'ipynb') {
    return <JupyterIcon size={size} className={className} />;
  }
  let spec = byExtension[extension];
  if (!spec) {
    if (name.startsWith('.env')) spec = byExtension.env;
    else if (name.toLowerCase() === '.gitignore') spec = byExtension.gitignore;
  }
  const Icon = spec?.icon || File;
  return (
    <Icon
      size={size}
      className={cn('shrink-0', spec?.className || 'text-mist-faint', className)}
      strokeWidth={1.7}
    />
  );
}
