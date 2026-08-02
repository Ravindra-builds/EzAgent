/** A minimal asynchronous FIFO used to bridge a running stream to an AsyncIterable consumer. */
export class AsyncQueue<T> implements AsyncIterable<T>, AsyncIterator<T> {
  private readonly values: T[] = [];
  private readonly waiters: Array<{
    readonly resolve: (result: IteratorResult<T>) => void;
    readonly reject: (reason?: unknown) => void;
  }> = [];
  private closed = false;
  private failure: unknown = undefined;

  push(value: T): void {
    if (this.closed) {
      return;
    }

    this.values.push(value);
    this.flush();
  }

  close(): void {
    if (this.closed) {
      return;
    }

    this.closed = true;
    this.flush();
  }

  fail(error: unknown): void {
    if (this.closed) {
      return;
    }

    this.closed = true;
    this.failure = error;
    this.flush();
  }

  async next(): Promise<IteratorResult<T>> {
    if (this.values.length > 0) {
      const value = this.values.shift();
      if (value !== undefined) {
        return { done: false, value };
      }
    }
    if (this.failure !== undefined) {
      return Promise.reject(this.failure);
    }
    if (this.closed) {
      return { done: true, value: undefined };
    }

    return new Promise<IteratorResult<T>>((resolve, reject) => {
      this.waiters.push({ reject, resolve });
    });
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return this;
  }

  private flush(): void {
    while (this.waiters.length > 0 && this.values.length > 0) {
      const waiter = this.waiters.shift();
      const value = this.values.shift();
      if (waiter !== undefined && value !== undefined) {
        waiter.resolve({ done: false, value });
      }
    }

    if (this.values.length > 0 || !this.closed) {
      return;
    }

    while (this.waiters.length > 0) {
      const waiter = this.waiters.shift();
      if (waiter === undefined) {
        continue;
      }
      if (this.failure !== undefined) {
        waiter.reject(this.failure);
      } else {
        waiter.resolve({ done: true, value: undefined });
      }
    }
  }
}
