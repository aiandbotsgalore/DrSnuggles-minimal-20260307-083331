/**
 * CircularBuffer — Bounded, fixed-capacity ring buffer.
 *
 * Prevents unbounded array growth for metrics, history, or any
 * append-only collection that only needs the most recent N items.
 */
export class CircularBuffer<T> {
  private buffer: (T | undefined)[];
  private head = 0;
  private _count = 0;

  constructor(private readonly capacity: number) {
    if (capacity <= 0) throw new RangeError('CircularBuffer capacity must be > 0');
    this.buffer = new Array(capacity);
  }

  /** Append an item. Overwrites the oldest item if at capacity. */
  push(item: T): void {
    this.buffer[this.head] = item;
    this.head = (this.head + 1) % this.capacity;
    if (this._count < this.capacity) this._count++;
  }

  /** Number of items currently stored. */
  get length(): number {
    return this._count;
  }

  /** Return all items in insertion order (oldest → newest). */
  toArray(): T[] {
    if (this._count < this.capacity) {
      return this.buffer.slice(0, this._count) as T[];
    }
    return [
      ...this.buffer.slice(this.head),
      ...this.buffer.slice(0, this.head),
    ] as T[];
  }

  /** Return the most recent `count` items (newest last). */
  getLatest(count: number): T[] {
    const n = Math.min(count, this._count);
    const result: T[] = [];
    for (let i = 0; i < n; i++) {
      const idx = (this.head - n + i + this.capacity) % this.capacity;
      result.push(this.buffer[idx] as T);
    }
    return result;
  }

  /** Clear all items. */
  clear(): void {
    this.buffer = new Array(this.capacity);
    this.head = 0;
    this._count = 0;
  }
}
