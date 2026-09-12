/**
 * Fixed-capacity circular buffer (Ring Buffer) for sliding window statistics.
 * Stores up to `capacity` items in FIFO order with O(1) push and lookup.
 */
export class RingBuffer<T> {
  private readonly buffer: Array<T | undefined>;
  private head = 0;
  private currentSize = 0;

  public constructor(public readonly capacity: number) {
    if (capacity <= 0 || !Number.isInteger(capacity)) {
      throw new Error(`RingBuffer capacity must be a positive integer, got ${capacity}`);
    }
    this.buffer = new Array<T | undefined>(capacity);
  }

  /**
   * Appends an item to the buffer, overwriting the oldest item if capacity is reached.
   */
  public push(item: T): void {
    this.buffer[this.head] = item;
    this.head = (this.head + 1) % this.capacity;
    if (this.currentSize < this.capacity) {
      this.currentSize += 1;
    }
  }

  /**
   * Returns current count of stored items.
   */
  public size(): number {
    return this.currentSize;
  }

  /**
   * Returns true if the buffer has filled its capacity.
   */
  public isFull(): boolean {
    return this.currentSize === this.capacity;
  }

  /**
   * Clears the buffer.
   */
  public clear(): void {
    this.buffer.fill(undefined);
    this.head = 0;
    this.currentSize = 0;
  }

  /**
   * Converts existing items to an array in chronological order (oldest to newest).
   */
  public toArray(): T[] {
    if (this.currentSize === 0) {
      return [];
    }

    const result: T[] = new Array(this.currentSize);
    const start = this.currentSize < this.capacity ? 0 : this.head;

    for (let i = 0; i < this.currentSize; i++) {
      const idx = (start + i) % this.capacity;
      result[i] = this.buffer[idx] as T;
    }

    return result;
  }

  /**
   * Reduces the stored items without converting to intermediate array.
   */
  public reduce<U>(callback: (accumulator: U, currentValue: T, index: number) => U, initialValue: U): U {
    let acc = initialValue;
    const start = this.currentSize < this.capacity ? 0 : this.head;

    for (let i = 0; i < this.currentSize; i++) {
      const idx = (start + i) % this.capacity;
      acc = callback(acc, this.buffer[idx] as T, i);
    }

    return acc;
  }
}
