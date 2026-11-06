export type Parsed =
  | { kind: 'json'; value: Record<string, any> }
  | { kind: 'text'; text: string };

const MAX_BUFFERED_LINES = 400;

// Splits pipeline stdout into JSON objects and text: the pipeline prints single-line
// events and pretty-printed blocks (video_ready, Freesound, ffprobe).
export class LineAssembler {
  private buffer: string[] = [];

  push(line: string): Parsed[] {
    const trimmed = line.trim();
    if (this.buffer.length) {
      this.buffer.push(line);
      if (trimmed === '}') {
        const value = tryObject(this.buffer.join('\n'));
        if (value) { this.buffer = []; return [{ kind: 'json', value }]; }
      }
      return this.buffer.length > MAX_BUFFERED_LINES ? this.flush() : [];
    }
    if (!trimmed) return [];
    if (trimmed.startsWith('{')) {
      const value = tryObject(trimmed);
      if (value) return [{ kind: 'json', value }];
      if (!trimmed.endsWith('}')) { this.buffer = [line]; return []; }
    }
    return [{ kind: 'text', text: trimmed }];
  }

  flush(): Parsed[] {
    const lines = this.buffer.map(l => l.trim()).filter(Boolean);
    this.buffer = [];
    return lines.map(text => ({ kind: 'text', text }));
  }
}

function tryObject(text: string): Record<string, any> | undefined {
  try {
    const value = JSON.parse(text);
    return value && typeof value === 'object' && !Array.isArray(value) ? value : undefined;
  } catch { return undefined; }
}
