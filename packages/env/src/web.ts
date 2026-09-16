/**
 * Web env：es globals + Fetch/URL/DOM（Abs 原生）。
 */

import { type Abs, type AbsSigImpl, litValue, strLit, numLit } from "@nudojs/core";
import {
  arrOf,
  envFn,
  nullLit,
  objAbs,
  promiseOf,
  undef,
  unionOf,
  prim,
} from "./abs-helpers.ts";
import { type EnvDefinition, defineEnv as defineEsEnv } from "./es.ts";

export type { EnvDefinition };

function absStr(a: Abs | undefined): string | undefined {
  if (!a) return undefined;
  const v = litValue(a);
  return typeof v === "string" ? v : undefined;
}

function makeURLObj(url: URL): Abs {
  return objAbs({
    href: strLit(url.href),
    origin: strLit(url.origin),
    protocol: strLit(url.protocol),
    username: strLit(url.username),
    password: strLit(url.password),
    host: strLit(url.host),
    hostname: strLit(url.hostname),
    port: strLit(url.port),
    pathname: strLit(url.pathname),
    search: strLit(url.search),
    searchParams: objAbs({
      append: envFn([prim.str(), prim.str()], undef()),
      delete: envFn([prim.str()], undef()),
      get: envFn([prim.str()], unionOf(prim.str(), nullLit())),
      getAll: envFn([prim.str()], arrOf(prim.str())),
      has: envFn([prim.str()], prim.bool()),
      set: envFn([prim.str(), prim.str()], undef()),
      sort: envFn([], undef()),
      toString: envFn([], prim.str(), () => strLit(url.searchParams.toString())),
      entries: envFn([], prim.unknown),
      keys: envFn([], prim.unknown),
      values: envFn([], prim.unknown),
      forEach: envFn([prim.unknown], undef()),
      size: numLit(url.searchParams.size),
    }),
    hash: strLit(url.hash),
    toString: envFn([], prim.str(), () => strLit(url.href)),
    toJSON: envFn([], prim.str(), () => strLit(url.href)),
  });
}

export function defineEnv(): EnvDefinition {
  const esEnv = defineEsEnv();

  const Headers = objAbs({
    append: envFn([prim.str(), prim.str()], undef()),
    delete: envFn([prim.str()], undef()),
    get: envFn([prim.str()], unionOf(prim.str(), nullLit())),
    has: envFn([prim.str()], prim.bool()),
    set: envFn([prim.str(), prim.str()], undef()),
    forEach: envFn([prim.unknown], undef()),
    entries: envFn([], prim.unknown),
    keys: envFn([], prim.unknown),
    values: envFn([], prim.unknown),
  });

  const bodySlots = {
    json: envFn([], promiseOf(prim.unknown)),
    text: envFn([], promiseOf(prim.str())),
    arrayBuffer: envFn([], promiseOf(prim.unknown)),
    blob: envFn([], promiseOf(prim.unknown)),
    formData: envFn([], promiseOf(prim.unknown)),
    clone: envFn([], prim.unknown),
    ok: prim.bool(),
    status: prim.num(),
    statusText: prim.str(),
    headers: Headers,
    url: prim.str(),
    redirected: prim.bool(),
    type: prim.str(),
    bodyUsed: prim.bool(),
  };

  const Response = objAbs(bodySlots);

  const Request = objAbs({
    ...bodySlots,
    method: prim.str(),
    url: prim.str(),
    body: unionOf(prim.unknown, nullLit()),
    mode: prim.str(),
    credentials: prim.str(),
    cache: prim.str(),
    redirect: prim.str(),
    referrer: prim.str(),
    integrity: prim.str(),
    signal: prim.unknown,
  });

  const URLSearchParams = objAbs({
    append: envFn([prim.str(), prim.str()], undef()),
    delete: envFn([prim.str()], undef()),
    get: envFn([prim.str()], unionOf(prim.str(), nullLit())),
    getAll: envFn([prim.str()], arrOf(prim.str())),
    has: envFn([prim.str()], prim.bool()),
    set: envFn([prim.str(), prim.str()], undef()),
    sort: envFn([], undef()),
    toString: envFn([], prim.str()),
    entries: envFn([], prim.unknown),
    keys: envFn([], prim.unknown),
    values: envFn([], prim.unknown),
    forEach: envFn([prim.unknown], undef()),
    size: prim.num(),
  });

  const URLObj = objAbs({
    href: prim.str(),
    origin: prim.str(),
    protocol: prim.str(),
    username: prim.str(),
    password: prim.str(),
    host: prim.str(),
    hostname: prim.str(),
    port: prim.str(),
    pathname: prim.str(),
    search: prim.str(),
    searchParams: URLSearchParams,
    hash: prim.str(),
    toString: envFn([], prim.str()),
    toJSON: envFn([], prim.str()),
  });

  const AbortController = objAbs({
    signal: prim.unknown,
    abort: envFn([], undef()),
  });

  const Storage = objAbs({
    getItem: envFn([prim.str()], unionOf(prim.str(), nullLit())),
    setItem: envFn([prim.str(), prim.str()], undef()),
    removeItem: envFn([prim.str()], undef()),
    clear: envFn([], undef()),
    key: envFn([prim.num()], unionOf(prim.str(), nullLit())),
    length: prim.num(),
  });

  const EventTarget = objAbs({
    addEventListener: envFn([prim.str(), prim.unknown], undef()),
    removeEventListener: envFn([prim.str(), prim.unknown], undef()),
    dispatchEvent: envFn([prim.unknown], prim.bool()),
  });

  const atobImpl: AbsSigImpl = (args) => {
    const v = args[0] ? litValue(args[0]) : undefined;
    if (typeof v !== "string") return undefined;
    try {
      return strLit(atob(v));
    } catch {
      return undefined;
    }
  };
  const btoaImpl: AbsSigImpl = (args) => {
    const v = args[0] ? litValue(args[0]) : undefined;
    if (typeof v !== "string") return undefined;
    try {
      return strLit(btoa(v));
    } catch {
      return undefined;
    }
  };

  const urlCtorImpl: AbsSigImpl = (args) => {
    const href = absStr(args[0]);
    const base = args[1] !== undefined ? absStr(args[1]) : undefined;
    if (href === undefined) return undefined;
    try {
      const url = base !== undefined ? new URL(href, base) : new URL(href);
      return makeURLObj(url);
    } catch {
      return undefined;
    }
  };

  const webGlobals: Record<string, Abs> = {
    fetch: envFn([unionOf(prim.str(), Request)], promiseOf(Response)),
    Request: envFn([prim.str(), prim.unknown], Request),
    Response: objAbs({
      json: envFn([prim.unknown], Response),
      redirect: envFn([prim.str(), prim.num()], Response),
      error: envFn([], Response),
    }),
    Headers: envFn([prim.unknown], Headers),

    URL: envFn([prim.str(), prim.str()], URLObj, urlCtorImpl),
    URLSearchParams: envFn([prim.unknown], URLSearchParams),

    setTimeout: envFn([prim.unknown, prim.num()], prim.num()),
    setInterval: envFn([prim.unknown, prim.num()], prim.num()),
    clearTimeout: envFn([prim.num()], undef()),
    clearInterval: envFn([prim.num()], undef()),
    queueMicrotask: envFn([prim.unknown], undef()),
    requestAnimationFrame: envFn([prim.unknown], prim.num()),
    cancelAnimationFrame: envFn([prim.num()], undef()),

    AbortController: envFn([], AbortController),
    AbortSignal: objAbs({
      abort: envFn([], prim.unknown),
      timeout: envFn([prim.num()], prim.unknown),
    }),

    atob: envFn([prim.str()], prim.str(), atobImpl),
    btoa: envFn([prim.str()], prim.str(), btoaImpl),
    TextEncoder: envFn(
      [],
      objAbs({
        encode: envFn([prim.str()], prim.unknown),
        encodeInto: envFn([prim.str(), prim.unknown], prim.unknown),
      }),
    ),
    TextDecoder: envFn(
      [prim.str()],
      objAbs({
        decode: envFn([prim.unknown], prim.str()),
        encoding: prim.str(),
        fatal: prim.bool(),
        ignoreBOM: prim.bool(),
      }),
    ),

    localStorage: Storage,
    sessionStorage: Storage,

    document: objAbs({
      getElementById: envFn(
        [prim.str()],
        unionOf(prim.unknown, nullLit()),
      ),
      querySelector: envFn(
        [prim.str()],
        unionOf(prim.unknown, nullLit()),
      ),
      querySelectorAll: envFn([prim.str()], prim.unknown),
      createElement: envFn([prim.str()], prim.unknown),
      createTextNode: envFn([prim.str()], prim.unknown),
      body: prim.unknown,
      head: prim.unknown,
      documentElement: prim.unknown,
      title: prim.str(),
      cookie: prim.str(),
      readyState: prim.str(),
      addEventListener: envFn([prim.str(), prim.unknown], undef()),
      removeEventListener: envFn([prim.str(), prim.unknown], undef()),
    }),

    window: prim.unknown,
    self: prim.unknown,
    navigator: objAbs({
      userAgent: prim.str(),
      language: prim.str(),
      languages: arrOf(prim.str()),
      onLine: prim.bool(),
      platform: prim.str(),
      clipboard: objAbs({
        readText: envFn([], promiseOf(prim.str())),
        writeText: envFn([prim.str()], promiseOf(undef())),
      }),
    }),
    location: objAbs({
      href: prim.str(),
      origin: prim.str(),
      protocol: prim.str(),
      host: prim.str(),
      hostname: prim.str(),
      port: prim.str(),
      pathname: prim.str(),
      search: prim.str(),
      hash: prim.str(),
      assign: envFn([prim.str()], undef()),
      replace: envFn([prim.str()], undef()),
      reload: envFn([], undef()),
    }),
    history: objAbs({
      length: prim.num(),
      state: prim.unknown,
      back: envFn([], undef()),
      forward: envFn([], undef()),
      go: envFn([prim.num()], undef()),
      pushState: envFn(
        [prim.unknown, prim.str(), prim.str()],
        undef(),
      ),
      replaceState: envFn(
        [prim.unknown, prim.str(), prim.str()],
        undef(),
      ),
    }),

    EventTarget: envFn([], EventTarget),
    Event: envFn(
      [prim.str(), prim.unknown],
      objAbs({
        type: prim.str(),
        target: unionOf(prim.unknown, nullLit()),
        currentTarget: unionOf(prim.unknown, nullLit()),
        bubbles: prim.bool(),
        cancelable: prim.bool(),
        defaultPrevented: prim.bool(),
        preventDefault: envFn([], undef()),
        stopPropagation: envFn([], undef()),
        stopImmediatePropagation: envFn([], undef()),
      }),
    ),
    CustomEvent: envFn([prim.str(), prim.unknown], prim.unknown),

    structuredClone: envFn([prim.unknown], prim.unknown),

    performance: objAbs({
      now: envFn([], prim.num()),
      mark: envFn([prim.str()], undef()),
      measure: envFn([prim.str(), prim.str(), prim.str()], prim.unknown),
      getEntriesByName: envFn([prim.str()], arrOf(prim.unknown)),
      getEntriesByType: envFn([prim.str()], arrOf(prim.unknown)),
      clearMarks: envFn([], undef()),
      clearMeasures: envFn([], undef()),
      timeOrigin: prim.num(),
    }),

    crypto: objAbs({
      randomUUID: envFn([], prim.str()),
      getRandomValues: envFn([prim.unknown], prim.unknown),
      subtle: objAbs({
        digest: envFn(
          [prim.str(), prim.unknown],
          promiseOf(prim.unknown),
        ),
        encrypt: envFn(
          [prim.unknown, prim.unknown, prim.unknown],
          promiseOf(prim.unknown),
        ),
        decrypt: envFn(
          [prim.unknown, prim.unknown, prim.unknown],
          promiseOf(prim.unknown),
        ),
        sign: envFn(
          [prim.unknown, prim.unknown, prim.unknown],
          promiseOf(prim.unknown),
        ),
        verify: envFn(
          [
            prim.unknown,
            prim.unknown,
            prim.unknown,
            prim.unknown,
          ],
          promiseOf(prim.bool()),
        ),
        generateKey: envFn(
          [prim.unknown, prim.bool(), arrOf(prim.str())],
          promiseOf(prim.unknown),
        ),
        importKey: envFn(
          [
            prim.str(),
            prim.unknown,
            prim.unknown,
            prim.bool(),
            arrOf(prim.str()),
          ],
          promiseOf(prim.unknown),
        ),
        exportKey: envFn(
          [prim.str(), prim.unknown],
          promiseOf(prim.unknown),
        ),
      }),
    }),
  };

  return {
    globals: { ...esEnv.globals, ...webGlobals },
  };
}
