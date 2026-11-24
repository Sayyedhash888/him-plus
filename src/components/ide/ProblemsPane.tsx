import { useMemo } from 'react';
import { AlertCircle, AlertTriangle, CheckCircle2, Info, Sparkles } from 'lucide-react';
import { useEditorStore } from '../../store/editor';
import { useCoreStore } from '../../store/core';
import { askAgentToFix, revealInEditor } from '../../lib/actions';
import { cn, relativeTo } from '../../lib/utils';
import { FileTypeIcon } from '../FileIcon';

const severityMeta = {
  1: { icon: AlertCircle, className: 'text-coral', label: 'Error' },
  2: { icon: AlertTriangle, className: 'text-sand', label: 'Warning' },
  3: { icon: Info, className: 'text-azure', label: 'Info' },
} as const;

export function ProblemsPane() {
  const problems = useEditorStore((state) => state.problems);
  const workspace = useCoreStore((state) => state.workspace);

  const groups = useMemo(() => {
    const map = new Map<string, typeof problems>();
    for (const problem of problems) {
      const list = map.get(problem.path) || [];
      list.push(problem);
      map.set(problem.path, list);
    }
    return [...map.entries()];
  }, [problems]);

  const errors = problems.filter((problem) => problem.severity === 1).length;
  const warnings = problems.filter((problem) => problem.severity === 2).length;

  if (problems.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center px-6 text-center">
        <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-full border border-mint/20 bg-mint/[0.05]">
          <CheckCircle2 size={16} className="text-mint" />
        </div>
        <div className="text-[11px] font-medium text-mist">No problems detected</div>
        <p className="mt-1 max-w-[320px] text-[9.5px] leading-relaxed text-mist-faint">
          Diagnostics from live language servers (LSP) and Monaco syntax models appear here. Open a
          Rust, TypeScript or Python file after installing its language server to see semantic
          errors, warnings and fixes.
        </p>
      </div>
    );
  }

  const fixGroup = (filePath: string, groupProblems: typeof problems) => {
    const relative = workspace ? relativeTo(workspace, filePath) : filePath;
    const details = groupProblems
      .slice(0, 10)
      .map(
        (problem) =>
          `- ${relative}:${problem.line}:${problem.column} — ${problem.message}${problem.source ? ` (${problem.source})` : ''}`,
      )
      .join('\n');
    void askAgentToFix({
      title: 'Fix editor diagnostics',
      details: `Problems reported by the editor:\n${details}`,
      createIfMissing: true,
    });
  };

  return (
    <div className="thin-scrollbar h-full overflow-y-auto p-2">
      <div className="flex items-center gap-2 px-2 py-1 text-[8.5px] text-mist-faint">
        <span className={errors > 0 ? 'text-coral' : ''}>{errors} errors</span>
        <span className="text-mist-ghost">·</span>
        <span className={warnings > 0 ? 'text-sand' : ''}>{warnings} warnings</span>
        <span className="ml-auto font-mono text-[8px] text-mist-ghost">
          {problems.length} total
        </span>
      </div>
      <div className="space-y-2">
        {groups.map(([filePath, groupProblems]) => {
          const relative = workspace ? relativeTo(workspace, filePath) : filePath;
          return (
            <div key={filePath} className="overflow-hidden rounded-md border border-line bg-ink-900/35">
              <div className="flex h-7 items-center gap-1.5 border-b border-line/60 px-2">
                <FileTypeIcon name={filePath} size={11} />
                <span className="min-w-0 flex-1 truncate font-mono text-[9px] text-mist">
                  {relative}
                </span>
                <span className="font-mono text-[8px] text-mist-ghost">
                  {groupProblems.length}
                </span>
                <button
                  onClick={() => fixGroup(filePath, groupProblems)}
                  className="ml-1 flex h-5 items-center gap-1 rounded border border-line px-1.5 text-[8px] text-mist-faint hover:border-accent/25 hover:text-accent-soft"
                >
                  <Sparkles size={8} /> Fix with agent
                </button>
              </div>
              {groupProblems.map((problem, index) => {
                const meta = severityMeta[(problem.severity as 1 | 2 | 3) || 3];
                const Icon = meta.icon;
                return (
                  <button
                    key={`${problem.line}:${problem.column}:${index}`}
                    onClick={() => void revealInEditor(problem.path, problem.line, problem.column)}
                    className="flex w-full items-start gap-2 border-b border-line/40 px-2.5 py-1.5 text-left last:border-0 hover:bg-ink-800/50"
                  >
                    <Icon size={11} className={cn('mt-0.5 shrink-0', meta.className)} />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[10px] leading-relaxed text-mist-dim">
                        {problem.message}
                      </span>
                      <span className="mt-0.5 flex items-center gap-1.5 font-mono text-[8px] text-mist-ghost">
                        <span>
                          Ln {problem.line}, Col {problem.column}
                        </span>
                        {problem.source && <span>· {problem.source}</span>}
                        <span>· {meta.label}</span>
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
