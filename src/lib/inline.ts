import type { LlmMessage } from '@shared/types';
import { cleanErrorMessage } from './bridge';
import { validateInlineOutput } from './inlineValidation';
import { useConfigStore, resolveDefaultModel } from '../store/config';
import { streamChat } from './agent/llmClient';
import { ThinkTagParser } from './agent/thinking';

export interface InlineEditInput {
  instruction: string;
  targetCode: string;
  filePath: string;
  language: string;
  contextBefore?: string;
  contextAfter?: string;
  previousAttempt?: string;
  signal?: AbortSignal;
  onDelta?(text: string): void;
}

export interface InlineEditResult {
  code: string;
  modelLabel: string;
}

export async function generateInlineEdit(input: InlineEditInput): Promise<InlineEditResult> {
  const config = useConfigStore.getState().config;
  const model = resolveDefaultModel(config, 'fast') || resolveDefaultModel(config, 'primary');
  if (!model) {
    throw new Error('Enable a model in Settings before using inline edit.');
  }
  if (!model.provider.baseUrl.trim()) {
    throw new Error(`Provider "${model.provider.name}" has no base URL.`);
  }
  if (!input.instruction.trim()) throw new Error('Describe the change first.');

  const system = `You are HIM Inline, a precise code editing engine inside a desktop IDE.
Rules:
- Return ONLY the replacement code for the target range.
- No Markdown fences, no explanations, no commentary, no emojis.
- Preserve the existing indentation style, quote style and language conventions.
- The target range will be replaced verbatim. Do not include surrounding code that should stay.
- If no change is needed, return the original target code unchanged.
- Do not invent imports or APIs unless required. Keep the edit minimal.`;

  const sections: string[] = [
    `File: ${input.filePath}`,
    `Language: ${input.language}`,
  ];
  if (input.contextBefore?.trim()) {
    sections.push(`Context before target:\n\`\`\`${input.language}\n${input.contextBefore.slice(-4000)}\n\`\`\``);
  }
  sections.push(`Target range to replace:\n\`\`\`${input.language}\n${input.targetCode}\n\`\`\``);
  if (input.contextAfter?.trim()) {
    sections.push(`Context after target:\n\`\`\`${input.language}\n${input.contextAfter.slice(0, 4000)}\n\`\`\``);
  }
  if (input.previousAttempt) {
    sections.push(`Previous attempt to revise:\n\`\`\`${input.language}\n${input.previousAttempt}\n\`\`\``);
  }
  sections.push(`Instruction:\n${input.instruction}`);

  const messages: LlmMessage[] = [
    { role: 'system', content: system },
    { role: 'user', content: sections.join('\n\n') },
  ];

  try {
    let streamed = '';
    const parser = new ThinkTagParser();
    const result = await streamChat({
      baseUrl: model.provider.baseUrl,
      apiKey: model.provider.apiKey,
      headers: model.provider.headers,
      model: model.model.id,
      messages,
      signal: input.signal,
      onContentDelta: (text) => {
        for (const part of parser.push(text)) {
          if (part.kind === 'content') {
            streamed += part.text;
            input.onDelta?.(streamed);
          }
        }
      },
    });
    for (const part of parser.finish()) {
      if (part.kind === 'content') {
        streamed += part.text;
        input.onDelta?.(streamed);
      }
    }
    // Streaming text is only for the preview. The code that gets applied is the
    // fully buffered output, sanitised and validated against the target range.
    // `validateInlineOutput` runs `sanitizeInlineOutput` first.
    const raw = result.content ? streamed || result.content : streamed;
    const validated = validateInlineOutput(input.targetCode, raw);
    if (!validated.ok && validated.reason !== 'no change') {
      throw new Error(
        `The model returned invalid edit output (${validated.reason ?? 'unknown reason'}) — nothing was applied.`,
      );
    }
    return { code: validated.code, modelLabel: `${model.provider.name} · ${model.model.id}` };
  } catch (error) {
    throw new Error(cleanErrorMessage(error));
  }
}
