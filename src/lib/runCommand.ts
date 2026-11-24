export interface RunnableTab {
  language: string;
  path: string;
}

function quoteArg(value: string): string {
  return `"${value.replace(/"/g, '\\"')}"`;
}

export function pythonRunCommand(filePath: string): string {
  return `python ${quoteArg(filePath)}`;
}

export function runCommandForTab(tab: RunnableTab): string | null {
  if (tab.language === 'python') return pythonRunCommand(tab.path);
  return null;
}