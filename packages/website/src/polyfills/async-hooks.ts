/**
 * Browser stand-in for `node:async_hooks` — only what Nudo core pulls into the
 * website/playground bundle. Node hosts still get the real module via package
 * exports; webpack aliases this file in for browser builds.
 */
export class AsyncLocalStorage<T> {
  private store: T | undefined;

  getStore(): T | undefined {
    return this.store;
  }

  enterWith(store: T): void {
    this.store = store;
  }

  run<R>(store: T, fn: () => R): R {
    const prev = this.store;
    this.store = store;
    try {
      return fn();
    } finally {
      this.store = prev;
    }
  }

  disable(): void {
    this.store = undefined;
  }

  exit<R>(fn: () => R): R {
    const prev = this.store;
    this.store = undefined;
    try {
      return fn();
    } finally {
      this.store = prev;
    }
  }
}

export class AsyncResource {
  static bind<R>(fn: R): R {
    return fn;
  }

  emitBefore(): void {}
  emitAfter(): void {}
  bind<R>(fn: R): R {
    return fn;
  }
}

export function executionAsyncId(): number {
  return 0;
}

export function triggerAsyncId(): number {
  return 0;
}

export function asyncWrapProviders(): Record<string, unknown> {
  return {};
}
