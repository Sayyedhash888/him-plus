import { uid } from '../utils';

export interface FallbackCall {
  id: string;
  name: string;
  arguments: string;
}

interface ParsedFallback {
  calls: FallbackCall[];
  cleaned: string;
  rawBlocks: string[];
}

function extractCallsFromValue(value: unknown, target: FallbackCall[]): boolean {
  if (Array.isArray(value)) {
    let found = false;
    for (const item of value) {
      if (extractCallsFromValue(item, target)) found = true;
    }
    return found;
  }
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;

  if (Array.isArray(record.tool_calls)) {
    return extractCallsFromValue(record.tool_calls, target);
  }
  if (Array.isArray(record.tools_calls)) {
    return extractCallsFromValue(record.tools_calls, target);
  }

  let name: unknown =
    record.name ??
    record.tool ??
    record.tool_name ??
    (record.function && typeof record.function === 'object'
      ? (record.function as Record<string, unknown>).name
      : undefined);

  let args: unknown =
    record.arguments ??
    record.args ??
    record.parameters ??
    record.input ??
    (record.function && typeof record.function === 'object'
      ? (record.function as Record<string, unknown>).arguments
      : undefined);

  if (typeof name !== 'string' || !name.trim()) return false;
  if (typeof args === 'string') {
    // Keep raw string; caller will parse and validate JSON.
  } else if (args && typeof args === 'object') {
    args = JSON.stringify(args);
  } else {
    args = '{}';
  }

  target.push({
    id: typeof record.id === 'string' && record.id ? record.id : uid('call'),
    name: name.trim(),
    arguments: args as string,
  });
  return true;
}

/**
 * Handles models that ignore native tool calling and print JSON tool requests
 * into the message body instead.
 */
export function parseFallbackToolCalls(content: string): ParsedFallback {
  const calls: FallbackCall[] = [];
  const rawBlocks: string[] = [];
  const cleanedParts: string[] = [];
  let lastIndex = 0;
  let matchedAnyBlock = false;

  const fenceRegex = /```(?:json|tool|tool_call|tool-call)?\s*\n?([\s\S]*?)```/gi;
  let match: RegExpExecArray | null;
  while ((match = fenceRegex.exec(content)) !== null) {
    const payload = match[1].trim();
    let json: unknown;
    try {
      json = JSON.parse(payload);
    } catch {
      continue;
    }
    const blockCalls: FallbackCall[] = [];
    if (extractCallsFromValue(json, blockCalls) && blockCalls.length > 0) {
      calls.push(...blockCalls);
      rawBlocks.push(match[0].trim());
      cleanedParts.push(content.slice(lastIndex, match.index));
      lastIndex = match.index + match[0].length;
      matchedAnyBlock = true;
    }
  }

  if (calls.length === 0) {
    const first = content.indexOf('{');
    const last = content.lastIndexOf('}');
    if (first !== -1 && last > first) {
      const candidate = content.slice(first, last + 1);
      try {
        const json = JSON.parse(candidate);
        const rootCalls: FallbackCall[] = [];
        if (extractCallsFromValue(json, rootCalls) && rootCalls.length > 0) {
          calls.push(...rootCalls);
          rawBlocks.push(candidate);
          cleanedParts.push(content.slice(0, first));
          lastIndex = last + 1;
          matchedAnyBlock = true;
        }
      } catch {
        // Not a JSON tool request.
      }
    }
  }

  if (!matchedAnyBlock) return { calls: [], cleaned: content, rawBlocks: [] };
  cleanedParts.push(content.slice(lastIndex));
  return {
    calls,
    cleaned: cleanedParts.join('').replace(/\n{3,}/g, '\n\n').trim(),
    rawBlocks,
  };
}
