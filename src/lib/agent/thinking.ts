const OPEN_TAG = /<(?:think|thinking)\s*>/i;
const CLOSE_TAG = /<\/(?:think|thinking)\s*>/i;
const OPEN_PREFIXES = ['<', '<t', '<th', '<thi', '<thin', '<think', '<thinki', '<thinkin', '<thinking'];
const CLOSE_PREFIXES = ['<', '</', '</t', '</th', '</thi', '</thin', '</think', '</thinki', '</thinkin', '</thinking'];

export interface SplitPart {
  kind: 'content' | 'reasoning';
  text: string;
}

function partialSuffix(value: string, prefixes: string[]): number {
  const lower = value.toLowerCase();
  for (const prefix of prefixes) {
    if (lower.endsWith(prefix)) return prefix.length;
  }
  return 0;
}

/**
 * Some OpenAI-compatible models leak `<think>` reasoning into `delta.content`.
 * This parser turns those tags into a separate stream without waiting for the
 * full response, while holding back partial tag suffixes between chunks.
 */
export class ThinkTagParser {
  private buffer = '';
  private inThink = false;

  push(chunk: string): SplitPart[] {
    this.buffer += chunk;
    const parts: SplitPart[] = [];

    while (this.buffer.length > 0) {
      if (this.inThink) {
        const close = CLOSE_TAG.exec(this.buffer);
        if (close) {
          const before = this.buffer.slice(0, close.index);
          if (before) parts.push({ kind: 'reasoning', text: before });
          this.buffer = this.buffer.slice(close.index + close[0].length);
          this.inThink = false;
          continue;
        }
        const keep = partialSuffix(this.buffer, CLOSE_PREFIXES);
        const emit = this.buffer.slice(0, this.buffer.length - keep);
        if (emit) parts.push({ kind: 'reasoning', text: emit });
        this.buffer = this.buffer.slice(this.buffer.length - keep);
        break;
      }
      const open = OPEN_TAG.exec(this.buffer);
      if (open) {
        const before = this.buffer.slice(0, open.index);
        if (before) parts.push({ kind: 'content', text: before });
        this.buffer = this.buffer.slice(open.index + open[0].length);
        this.inThink = true;
        continue;
      }
      const keep = partialSuffix(this.buffer, OPEN_PREFIXES);
      const emit = this.buffer.slice(0, this.buffer.length - keep);
      if (emit) parts.push({ kind: 'content', text: emit });
      this.buffer = this.buffer.slice(this.buffer.length - keep);
      break;
    }

    return parts;
  }

  finish(): SplitPart[] {
    if (!this.buffer) return [];
    const part: SplitPart = {
      kind: this.inThink ? 'reasoning' : 'content',
      text: this.buffer,
    };
    this.buffer = '';
    return [part];
  }
}
