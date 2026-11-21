export const MLLP_START = 0x0b;
export const MLLP_END = 0x1c;
export const MLLP_CR = 0x0d;

export type MllpDecodeEvent =
  | { type: 'frame'; payload: Buffer }
  | { type: 'error'; message: string };

export class MllpDecoder {
  private buffer = Buffer.alloc(0);

  constructor(private readonly maxMessageBytes: number) {}

  push(chunk: Buffer): MllpDecodeEvent[] {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    const events: MllpDecodeEvent[] = [];
    while (this.buffer.length > 0) {
      if (this.buffer[0] !== MLLP_START) {
        events.push({ type: 'error', message: 'MLLP frame must begin with VT.' });
        this.buffer = Buffer.alloc(0);
        break;
      }
      const nestedStart = this.buffer.indexOf(MLLP_START, 1);
      const end = this.buffer.indexOf(MLLP_END, 1);
      if (nestedStart >= 0 && (end < 0 || nestedStart < end)) {
        events.push({ type: 'error', message: 'Nested MLLP frame start.' });
        this.buffer = this.buffer.subarray(nestedStart);
        continue;
      }
      if (end < 0) {
        if (this.buffer.length - 1 > this.maxMessageBytes) {
          events.push({ type: 'error', message: 'MLLP message exceeds the configured limit.' });
          this.buffer = Buffer.alloc(0);
        }
        break;
      }
      if (end + 1 >= this.buffer.length) break;
      if (this.buffer[end + 1] !== MLLP_CR) {
        events.push({ type: 'error', message: 'MLLP FS must be followed by CR.' });
        this.buffer = Buffer.alloc(0);
        break;
      }
      const payload = this.buffer.subarray(1, end);
      this.buffer = this.buffer.subarray(end + 2);
      if (payload.length > this.maxMessageBytes) {
        events.push({ type: 'error', message: 'MLLP message exceeds the configured limit.' });
      } else {
        events.push({ type: 'frame', payload });
      }
    }
    return events;
  }
}

export function frameMllp(payload: string): Buffer {
  return Buffer.concat([Buffer.from([MLLP_START]), Buffer.from(payload, 'utf8'), Buffer.from([MLLP_END, MLLP_CR])]);
}
