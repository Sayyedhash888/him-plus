import type { ModelCapabilities } from '@shared/types';

/**
 * Best-effort capability inference from a model id.
 *
 * Provider catalogs are inconsistent: most do not expose modality or context
 * window metadata through `/models`, so HIM+ keeps a compact rule table and
 * lets a configured value win. This is used for UI affordances (attach button,
 * context meter) and for cheap client-side budgeting, never for correctness.
 */

const VISION_PATTERNS: RegExp[] = [
  // OpenAI
  /(^|[-/])(gpt-4o|gpt-4\.1|gpt-4-turbo|gpt-4-vision|gpt-5|o3|o4-mini|chatgpt-4o)/i,
  // Anthropic
  /claude-(3|4|sonnet|opus|haiku)/i,
  // Google
  /gemini/i,
  // Open weights
  /(llava|pixtral|qwen2?(\.5)?-?vl|qwen-?vl|glm-4v|internvl|minicpm-v|moondream|gemma3|llama-?3\.2|llama-4|phi-4-multimodal|kimi-vl)/i,
  // Others
  /(grok-(2|3|4)|grok-vision|mistral-medium-3|mistral-small-3\.1|nova-(lite|pro)|step-1v|yi-vl|deepseek-vl)/i,
];

const NO_VISION_PATTERNS: RegExp[] = [
  /(^|[-/])(gpt-3\.5|text-davinci|text-embedding|whisper|tts|dall-e|davinci)/i,
  /(embed|rerank|moderation|transcribe|whisper)/i,
];

const CONTEXT_PATTERNS: Array<{ pattern: RegExp; window: number }> = [
  { pattern: /gemini-1\.5|gemini-2|gemini-exp/i, window: 1_000_000 },
  { pattern: /claude/i, window: 200_000 },
  { pattern: /gpt-5|o3|o4/i, window: 400_000 },
  { pattern: /gpt-4\.1/i, window: 1_000_000 },
  { pattern: /gpt-4o|gpt-4-turbo|gpt-4-vision/i, window: 128_000 },
  { pattern: /gpt-4/i, window: 128_000 },
  { pattern: /qwen/i, window: 131_072 },
  { pattern: /deepseek/i, window: 128_000 },
  { pattern: /llama-4|llama-3\.3/i, window: 128_000 },
  { pattern: /llama-3\.1|llama3\.1/i, window: 128_000 },
  { pattern: /llama-3|llama3/i, window: 8_192 },
  { pattern: /mistral|mixtral/i, window: 32_768 },
  { pattern: /kimi|moonshot/i, window: 131_072 },
];

const DEFAULT_CONTEXT_WINDOW = 32_768;

export function inferModelCapabilities(modelId: string): ModelCapabilities {
  const id = (modelId || '').trim();
  let vision: boolean | undefined;
  if (NO_VISION_PATTERNS.some((pattern) => pattern.test(id))) {
    vision = false;
  } else if (VISION_PATTERNS.some((pattern) => pattern.test(id))) {
    vision = true;
  }
  let contextWindow = DEFAULT_CONTEXT_WINDOW;
  for (const entry of CONTEXT_PATTERNS) {
    if (entry.pattern.test(id)) {
      contextWindow = entry.window;
      break;
    }
  }
  // Reasoning models and newer chat models almost always accept tools.
  const tools = !/(embed|rerank|moderation|transcribe|whisper|tts)/i.test(id);
  return { vision, tools, contextWindow };
}

export function resolveCapabilities(
  modelId: string,
  configured?: ModelCapabilities | null,
): Required<ModelCapabilities> {
  const inferred = inferModelCapabilities(modelId);
  return {
    vision: configured?.vision ?? inferred.vision ?? false,
    tools: configured?.tools ?? inferred.tools ?? true,
    contextWindow:
      configured?.contextWindow && configured.contextWindow > 0
        ? configured.contextWindow
        : inferred.contextWindow ?? DEFAULT_CONTEXT_WINDOW,
  };
}

export function modelSupportsVision(
  modelId: string,
  configured?: ModelCapabilities | null,
): boolean {
  return resolveCapabilities(modelId, configured).vision;
}
