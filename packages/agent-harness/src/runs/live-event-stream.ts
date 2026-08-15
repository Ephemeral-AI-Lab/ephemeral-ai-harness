export class LiveEventStream<TEvent> implements AsyncIterable<TEvent> {
  readonly #buffer: TEvent[] = [];
  readonly #wakers = new Set<() => void>();
  #closed = false;
  #detached = false;
  #consumed = false;

  push(event: TEvent): void {
    if (this.#closed || this.#detached) return;
    this.#buffer.push(event);
    this.#wake();
  }

  close(): void {
    this.#closed = true;
    this.#wake();
  }

  [Symbol.asyncIterator](): AsyncIterator<TEvent, undefined> {
    if (this.#consumed) {
      throw new Error("events() supports a single consumer");
    }
    this.#consumed = true;
    return {
      next: () => this.#next(),
      return: () => {
        this.#detached = true;
        this.#buffer.length = 0;
        this.#wake();
        return Promise.resolve<IteratorResult<TEvent, undefined>>({
          done: true,
          value: undefined,
        });
      },
    };
  }

  async #next(): Promise<IteratorResult<TEvent, undefined>> {
    for (;;) {
      if (this.#detached) return { done: true, value: undefined };
      const event = this.#buffer.shift();
      if (event !== undefined) return { done: false, value: event };
      if (this.#closed) return { done: true, value: undefined };
      await new Promise<void>((resolve) => {
        this.#wakers.add(resolve);
      });
    }
  }

  #wake(): void {
    for (const wake of this.#wakers) wake();
    this.#wakers.clear();
  }
}
