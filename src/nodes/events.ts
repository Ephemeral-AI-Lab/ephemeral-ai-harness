export interface Clock {
  now(): Date;
}

export const systemClock: Clock = {
  now: () => new Date(),
};

export interface EventBase {
  seq: number;
  time: string;
}

export type RunEventBase = EventBase;

export interface NodeRunEventBase extends EventBase {
  nodeName: string;
}

export interface RunEventStream<TEvent extends EventBase> {
  emit(body: EventBody<TEvent>): TEvent;
  events(): AsyncIterable<TEvent>;
  close(): void;
}

export type EventBody<TEvent extends EventBase> = TEvent extends EventBase
  ? Omit<TEvent, keyof EventBase>
  : never;

class LiveEventStream<TEvent extends EventBase>
  implements AsyncIterable<TEvent> {
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
        this.#detach();
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

  #detach(): void {
    this.#detached = true;
    this.#buffer.length = 0;
    this.#wake();
  }

  #wake(): void {
    for (const wake of this.#wakers) wake();
    this.#wakers.clear();
  }
}

export function createRunEventStream<TEvent extends EventBase>(config: {
  clock: Clock;
}): RunEventStream<TEvent> {
  const live = new LiveEventStream<TEvent>();
  let seq = 0;
  return {
    emit(body) {
      const event = {
        ...body,
        seq,
        time: config.clock.now().toISOString(),
      } as unknown as TEvent;
      seq += 1;
      live.push(event);
      return event;
    },
    events: () => live,
    close: () => {
      live.close();
    },
  };
}
