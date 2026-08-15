import { type TypeValue, type SigImpl, T } from "@nudojs/core";
import { type EnvDefinition, defineEnv as defineEsEnv } from "@nudojs/env-es";

export type { EnvDefinition };

function litStr(tv: TypeValue): string | undefined {
  return tv.kind === "literal" && typeof tv.value === "string" ? tv.value : undefined;
}

function makeURLObj(url: URL): TypeValue {
  return T.object({
    href: T.literal(url.href),
    origin: T.literal(url.origin),
    protocol: T.literal(url.protocol),
    username: T.literal(url.username),
    password: T.literal(url.password),
    host: T.literal(url.host),
    hostname: T.literal(url.hostname),
    port: T.literal(url.port),
    pathname: T.literal(url.pathname),
    search: T.literal(url.search),
    searchParams: T.object({
      append: T.fnSig([T.string, T.string], T.undefined),
      delete: T.fnSig([T.string], T.undefined),
      get: T.fnSig([T.string], T.union(T.string, T.null)),
      getAll: T.fnSig([T.string], T.array(T.string)),
      has: T.fnSig([T.string], T.boolean),
      set: T.fnSig([T.string, T.string], T.undefined),
      sort: T.fnSig([], T.undefined),
      toString: T.fnSig([], T.string, T.never, () => T.literal(url.searchParams.toString())),
      entries: T.fnSig([], T.unknown),
      keys: T.fnSig([], T.unknown),
      values: T.fnSig([], T.unknown),
      forEach: T.fnSig([T.unknown], T.undefined),
      size: T.literal(url.searchParams.size),
    }),
    hash: T.literal(url.hash),
    toString: T.fnSig([], T.string, T.never, () => T.literal(url.href)),
    toJSON: T.fnSig([], T.string, T.never, () => T.literal(url.href)),
  });
}

export function defineEnv(): EnvDefinition {
  const esEnv = defineEsEnv();

  const Headers = T.object({
    append: T.fnSig([T.string, T.string], T.undefined),
    delete: T.fnSig([T.string], T.undefined),
    get: T.fnSig([T.string], T.union(T.string, T.null)),
    has: T.fnSig([T.string], T.boolean),
    set: T.fnSig([T.string, T.string], T.undefined),
    forEach: T.fnSig([T.unknown], T.undefined),
    entries: T.fnSig([], T.unknown),
    keys: T.fnSig([], T.unknown),
    values: T.fnSig([], T.unknown),
  });

  const Body = {
    json: T.fnSig([], T.promise(T.unknown)),
    text: T.fnSig([], T.promise(T.string)),
    arrayBuffer: T.fnSig([], T.promise(T.unknown)),
    blob: T.fnSig([], T.promise(T.unknown)),
    formData: T.fnSig([], T.promise(T.unknown)),
    clone: T.fnSig([], T.unknown),
    ok: T.boolean,
    status: T.number,
    statusText: T.string,
    headers: Headers,
    url: T.string,
    redirected: T.boolean,
    type: T.string,
    bodyUsed: T.boolean,
  };

  const Response = T.object(Body);

  const Request = T.object({
    ...Body,
    method: T.string,
    url: T.string,
    headers: Headers,
    body: T.union(T.unknown, T.null),
    mode: T.string,
    credentials: T.string,
    cache: T.string,
    redirect: T.string,
    referrer: T.string,
    integrity: T.string,
    signal: T.unknown,
    clone: T.fnSig([], T.unknown),
  });

  const URLSearchParams = T.object({
    append: T.fnSig([T.string, T.string], T.undefined),
    delete: T.fnSig([T.string], T.undefined),
    get: T.fnSig([T.string], T.union(T.string, T.null)),
    getAll: T.fnSig([T.string], T.array(T.string)),
    has: T.fnSig([T.string], T.boolean),
    set: T.fnSig([T.string, T.string], T.undefined),
    sort: T.fnSig([], T.undefined),
    toString: T.fnSig([], T.string),
    entries: T.fnSig([], T.unknown),
    keys: T.fnSig([], T.unknown),
    values: T.fnSig([], T.unknown),
    forEach: T.fnSig([T.unknown], T.undefined),
    size: T.number,
  });

  const URLObj = T.object({
    href: T.string,
    origin: T.string,
    protocol: T.string,
    username: T.string,
    password: T.string,
    host: T.string,
    hostname: T.string,
    port: T.string,
    pathname: T.string,
    search: T.string,
    searchParams: URLSearchParams,
    hash: T.string,
    toString: T.fnSig([], T.string),
    toJSON: T.fnSig([], T.string),
  });

  const AbortController = T.object({
    signal: T.unknown,
    abort: T.fnSig([], T.undefined),
  });

  const Storage = T.object({
    getItem: T.fnSig([T.string], T.union(T.string, T.null)),
    setItem: T.fnSig([T.string, T.string], T.undefined),
    removeItem: T.fnSig([T.string], T.undefined),
    clear: T.fnSig([], T.undefined),
    key: T.fnSig([T.number], T.union(T.string, T.null)),
    length: T.number,
  });

  const EventTarget = T.object({
    addEventListener: T.fnSig([T.string, T.unknown], T.undefined),
    removeEventListener: T.fnSig([T.string, T.unknown], T.undefined),
    dispatchEvent: T.fnSig([T.unknown], T.boolean),
  });

  const webGlobals: Record<string, TypeValue> = {
    // --- Fetch API ---
    fetch: T.fnSig([T.union(T.string, Request)], T.promise(Response)),
    Request: T.fnSig([T.string, T.unknown], Request),
    Response: T.object({
      json: T.fnSig([T.unknown], Response),
      redirect: T.fnSig([T.string, T.number], Response),
      error: T.fnSig([], Response),
    }),
    Headers: T.fnSig([T.unknown], Headers),

    // --- URL ---
    URL: T.fnSig([T.string, T.string], URLObj, T.instanceOf("TypeError"), (args) => {
      const href = litStr(args[0]);
      const base = args[1] !== undefined ? litStr(args[1]) : undefined;
      if (href === undefined) return undefined;
      try {
        const url = base !== undefined ? new URL(href, base) : new URL(href);
        return makeURLObj(url);
      } catch { return undefined; }
    }),
    URLSearchParams: T.fnSig([T.unknown], URLSearchParams),

    // --- Timers ---
    setTimeout: T.fnSig([T.unknown, T.number], T.number),
    setInterval: T.fnSig([T.unknown, T.number], T.number),
    clearTimeout: T.fnSig([T.number], T.undefined),
    clearInterval: T.fnSig([T.number], T.undefined),
    queueMicrotask: T.fnSig([T.unknown], T.undefined),
    requestAnimationFrame: T.fnSig([T.unknown], T.number),
    cancelAnimationFrame: T.fnSig([T.number], T.undefined),

    // --- Abort ---
    AbortController: T.fnSig([], AbortController),
    AbortSignal: T.object({
      abort: T.fnSig([], T.unknown),
      timeout: T.fnSig([T.number], T.unknown),
    }),

    // --- Encoding ---
    atob: T.fnSig([T.string], T.string, T.never, (args) => {
      const s = litStr(args[0]);
      if (s === undefined) return undefined;
      try { return T.literal(atob(s)); } catch { return undefined; }
    }),
    btoa: T.fnSig([T.string], T.string, T.never, (args) => {
      const s = litStr(args[0]);
      if (s === undefined) return undefined;
      try { return T.literal(btoa(s)); } catch { return undefined; }
    }),
    TextEncoder: T.fnSig([], T.object({
      encode: T.fnSig([T.string], T.unknown),
      encodeInto: T.fnSig([T.string, T.unknown], T.unknown),
    })),
    TextDecoder: T.fnSig([T.string], T.object({
      decode: T.fnSig([T.unknown], T.string),
      encoding: T.string,
      fatal: T.boolean,
      ignoreBOM: T.boolean,
    })),

    // --- Storage ---
    localStorage: Storage,
    sessionStorage: Storage,

    // --- DOM (minimal) ---
    document: T.object({
      getElementById: T.fnSig([T.string], T.union(T.unknown, T.null)),
      querySelector: T.fnSig([T.string], T.union(T.unknown, T.null)),
      querySelectorAll: T.fnSig([T.string], T.unknown),
      createElement: T.fnSig([T.string], T.unknown),
      createTextNode: T.fnSig([T.string], T.unknown),
      body: T.unknown,
      head: T.unknown,
      documentElement: T.unknown,
      title: T.string,
      cookie: T.string,
      readyState: T.string,
      addEventListener: T.fnSig([T.string, T.unknown], T.undefined),
      removeEventListener: T.fnSig([T.string, T.unknown], T.undefined),
    }),

    // --- Window ---
    window: T.unknown,
    self: T.unknown,
    navigator: T.object({
      userAgent: T.string,
      language: T.string,
      languages: T.array(T.string),
      onLine: T.boolean,
      platform: T.string,
      clipboard: T.object({
        readText: T.fnSig([], T.promise(T.string)),
        writeText: T.fnSig([T.string], T.promise(T.undefined)),
      }),
    }),
    location: T.object({
      href: T.string,
      origin: T.string,
      protocol: T.string,
      host: T.string,
      hostname: T.string,
      port: T.string,
      pathname: T.string,
      search: T.string,
      hash: T.string,
      assign: T.fnSig([T.string], T.undefined),
      replace: T.fnSig([T.string], T.undefined),
      reload: T.fnSig([], T.undefined),
    }),
    history: T.object({
      length: T.number,
      state: T.unknown,
      back: T.fnSig([], T.undefined),
      forward: T.fnSig([], T.undefined),
      go: T.fnSig([T.number], T.undefined),
      pushState: T.fnSig([T.unknown, T.string, T.string], T.undefined),
      replaceState: T.fnSig([T.unknown, T.string, T.string], T.undefined),
    }),

    // --- Events ---
    EventTarget: T.fnSig([], EventTarget),
    Event: T.fnSig([T.string, T.unknown], T.object({
      type: T.string,
      target: T.union(T.unknown, T.null),
      currentTarget: T.union(T.unknown, T.null),
      bubbles: T.boolean,
      cancelable: T.boolean,
      defaultPrevented: T.boolean,
      preventDefault: T.fnSig([], T.undefined),
      stopPropagation: T.fnSig([], T.undefined),
      stopImmediatePropagation: T.fnSig([], T.undefined),
    })),
    CustomEvent: T.fnSig([T.string, T.unknown], T.unknown),

    // --- Structured clone ---
    structuredClone: T.fnSig([T.unknown], T.unknown),

    // --- Performance ---
    performance: T.object({
      now: T.fnSig([], T.number),
      mark: T.fnSig([T.string], T.undefined),
      measure: T.fnSig([T.string, T.string, T.string], T.unknown),
      getEntriesByName: T.fnSig([T.string], T.array(T.unknown)),
      getEntriesByType: T.fnSig([T.string], T.array(T.unknown)),
      clearMarks: T.fnSig([], T.undefined),
      clearMeasures: T.fnSig([], T.undefined),
      timeOrigin: T.number,
    }),

    // --- Crypto ---
    crypto: T.object({
      randomUUID: T.fnSig([], T.string),
      getRandomValues: T.fnSig([T.unknown], T.unknown),
      subtle: T.object({
        digest: T.fnSig([T.string, T.unknown], T.promise(T.unknown)),
        encrypt: T.fnSig([T.unknown, T.unknown, T.unknown], T.promise(T.unknown)),
        decrypt: T.fnSig([T.unknown, T.unknown, T.unknown], T.promise(T.unknown)),
        sign: T.fnSig([T.unknown, T.unknown, T.unknown], T.promise(T.unknown)),
        verify: T.fnSig([T.unknown, T.unknown, T.unknown, T.unknown], T.promise(T.boolean)),
        generateKey: T.fnSig([T.unknown, T.boolean, T.array(T.string)], T.promise(T.unknown)),
        importKey: T.fnSig([T.string, T.unknown, T.unknown, T.boolean, T.array(T.string)], T.promise(T.unknown)),
        exportKey: T.fnSig([T.string, T.unknown], T.promise(T.unknown)),
      }),
    }),
  };

  return {
    globals: { ...esEnv.globals, ...webGlobals },
  };
}
