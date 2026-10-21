/**
 * Web env：es globals + Fetch/URL/DOM（Abs 原生）。
 */

import { type Abs, type AbsSigImpl, strLit, numLit } from "@nudojs/core";
import { absStrLit } from "@nudojs/core/internal";
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

  /**
   * Request / Response **共有**面（Bug 887）：body 读取族 + headers/url/bodyUsed。
   *
   * `bodyUsed` 两侧都有（WHATWG Fetch `Request.bodyUsed` / `Response.bodyUsed`
   * 各一；node v26 undici 实测 `new Request(u).bodyUsed` 存在）⇒ 归共有面，
   * **不是** Response 专有。
   */
  const bodyReadSlots = {
    json: envFn([], promiseOf(prim.unknown)),
    text: envFn([], promiseOf(prim.str())),
    arrayBuffer: envFn([], promiseOf(prim.unknown)),
    blob: envFn([], promiseOf(prim.unknown)),
    formData: envFn([], promiseOf(prim.unknown)),
    clone: envFn([], prim.unknown),
    headers: Headers,
    url: prim.str(),
    bodyUsed: prim.bool(),
  };

  /**
   * Response **专有**状态面（Bug 887）：原生 `Request` **没有**这些成员
   * （node v26 undici 实测 `new Request(u).status === undefined`；
   * WebIDL `Request` 无 status/ok/statusText/redirected/type）⇒ 只挂 Response。
   */
  const responseStatusSlots = {
    ok: prim.bool(),
    status: prim.num(),
    statusText: prim.str(),
    redirected: prim.bool(),
    type: prim.str(),
  };

  const Response = objAbs({ ...bodyReadSlots, ...responseStatusSlots });

  /**
   * Request **自有**成员表（Bug 887）：**不**展开 Response 的状态面
   * （原生读出恒 `undefined`）⇒ 展开即错值。
   */
  const Request = objAbs({
    ...bodyReadSlots,
    method: prim.str(),
    body: unionOf(prim.unknown, nullLit()),
    mode: prim.str(),
    credentials: prim.str(),
    cache: prim.str(),
    redirect: prim.str(),
    referrer: prim.str(),
    referrerPolicy: prim.str(),
    integrity: prim.str(),
    signal: prim.unknown,
    keepalive: prim.bool(),
    duplex: prim.str(),
    destination: prim.str(),
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

  /**
   * Event 实例面（Bug 860）：`Event` / `CustomEvent` 共有成员
   * （DOM `Event` 接口 + `EventTarget` 继承面）。
   */
  const eventSlots = {
    type: prim.str(),
    target: unionOf(prim.unknown, nullLit()),
    currentTarget: unionOf(prim.unknown, nullLit()),
    bubbles: prim.bool(),
    cancelable: prim.bool(),
    composed: prim.bool(),
    defaultPrevented: prim.bool(),
    isTrusted: prim.bool(),
    timeStamp: prim.num(),
    preventDefault: envFn([], undef()),
    stopPropagation: envFn([], undef()),
    stopImmediatePropagation: envFn([], undef()),
  };

  const EventInstance = objAbs(eventSlots);

  /** CustomEvent 实例面：Event 共有面 + `detail`（DOM `CustomEvent`）。 */
  const CustomEventInstance = objAbs({ ...eventSlots, detail: prim.unknown });

  /**
   * 浏览器构造器实例面（Bug 870）。
   */
  const DOMParserInstance = objAbs({
    parseFromString: envFn([prim.str(), prim.str()], prim.unknown),
  });

  const XMLHttpRequestInstance = objAbs({
    open: envFn([prim.str(), prim.str(), prim.bool()], undef()),
    send: envFn([prim.unknown], undef()),
    abort: envFn([], undef()),
    setRequestHeader: envFn([prim.str(), prim.str()], undef()),
    getResponseHeader: envFn([prim.str()], unionOf(prim.str(), nullLit())),
    getAllResponseHeaders: envFn([], prim.str()),
    overrideMimeType: envFn([prim.str()], undef()),
    responseText: prim.str(),
    response: prim.unknown,
    responseType: prim.str(),
    status: prim.num(),
    statusText: prim.str(),
    readyState: prim.num(),
    timeout: prim.num(),
    withCredentials: prim.bool(),
    upload: prim.unknown,
    addEventListener: envFn([prim.str(), prim.unknown], undef()),
    removeEventListener: envFn([prim.str(), prim.unknown], undef()),
  });

  const WorkerInstance = objAbs({
    postMessage: envFn([prim.unknown], undef()),
    terminate: envFn([], undef()),
    onmessage: prim.unknown,
    onerror: prim.unknown,
    onmessageerror: prim.unknown,
    addEventListener: envFn([prim.str(), prim.unknown], undef()),
    removeEventListener: envFn([prim.str(), prim.unknown], undef()),
  });

  const FileReaderInstance = objAbs({
    readAsText: envFn([prim.unknown], undef()),
    readAsDataURL: envFn([prim.unknown], undef()),
    readAsArrayBuffer: envFn([prim.unknown], undef()),
    readAsBinaryString: envFn([prim.unknown], undef()),
    abort: envFn([], undef()),
    load: envFn([prim.unknown], undef()),
    result: prim.unknown,
    error: prim.unknown,
    readyState: prim.num(),
    onload: prim.unknown,
    onerror: prim.unknown,
    addEventListener: envFn([prim.str(), prim.unknown], undef()),
    removeEventListener: envFn([prim.str(), prim.unknown], undef()),
  });

  const IntersectionObserverInstance = objAbs({
    observe: envFn([prim.unknown], undef()),
    unobserve: envFn([prim.unknown], undef()),
    disconnect: envFn([], undef()),
    takeRecords: envFn([], arrOf(prim.unknown)),
  });

  const urlCtorImpl: AbsSigImpl = (args) => {
    const href = absStrLit(args[0]);
    const base = args[1] !== undefined ? absStrLit(args[1]) : undefined;
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
    // Bug 860：浏览器构造器必须带 `ctor: true`——否则 `$new` 走「fn 无 ctor
    // ⇒ 记 unknown-constructibility 假 may-throw」分支（假红）。
    // `name` 只用于 `class X extends <Ctor>` 的链键（issue #106），不改变
    // 构造面（evalBuiltinNew 对这些名字无 case ⇒ 仍回落 env 声明面）。
    Request: envFn([prim.str(), prim.unknown], Request, undefined, {
      name: "Request", ctor: true,
    }),
    // Bug 860：Response 原先是 `objAbs({json, redirect, error})`——**根本不是
    // 函数** ⇒ `new Response()` 被判「obj 非构造器」⇒ 确定 TypeError。
    // 改成可构造的 envFn：返回面仍是 bodySlots 对象；静态面走 `slots`。
    Response: envFn([prim.unknown], Response, undefined, {
      name: "Response", ctor: true,
      slots: {
        json: envFn([prim.unknown], Response),
        redirect: envFn([prim.str(), prim.num()], Response),
        error: envFn([], Response),
      },
    }),
    Headers: envFn([prim.unknown], Headers, undefined, {
      name: "Headers", ctor: true,
    }),

    // ctor:true 杀 constructibility 假抛；不带 name——$new 按名派发会改道
    // evalBuiltinNew/makeUrlAbs，丢 env urlCtorImpl 的字面量精确解析面
    // （fn-sig-impl 的 URL 用例依赖 impl 路径）。
    URL: envFn([prim.str(), prim.str()], URLObj, urlCtorImpl, {
      ctor: true, params: ["input", "base?"],
    }),
    URLSearchParams: envFn([prim.unknown], URLSearchParams, undefined, {
      name: "URLSearchParams", ctor: true,
    }),

    setTimeout: envFn([prim.unknown, prim.num()], prim.num()),
    setInterval: envFn([prim.unknown, prim.num()], prim.num()),
    clearTimeout: envFn([prim.num()], undef()),
    clearInterval: envFn([prim.num()], undef()),
    // Bug 888：queueMicrotask 的 env 声明**删掉** ⇒ 回落宿主内建 ⇒ core 的
    // `validateCallableArg`（calls.ts）生效：`queueMicrotask(1)` 记 TypeError
    // （原生如实）。env 声明会整条短路 core 的通用可调用性校验（假绿）。
    requestAnimationFrame: envFn([prim.unknown], prim.num()),
    cancelAnimationFrame: envFn([prim.num()], undef()),

    AbortController: envFn([], AbortController, undefined, {
      name: "AbortController", ctor: true,
    }),
    AbortSignal: objAbs({
      abort: envFn([], prim.unknown),
      timeout: envFn([prim.num()], prim.unknown),
      // Bug 873：AbortSignal.any(signals) 静态工厂（ES2024 / node ≥ 20）。
      any: envFn([arrOf(prim.unknown)], prim.unknown),
    }),

    // Bug 883 / 886 / 889：atob / btoa / TextEncoder / TextDecoder 的 env
    // 声明**删掉** ⇒ 回落宿主内建（core 已有**更精确**的建模）：
    // - atob/btoa → core 的 GLOBAL_FNS 分派：字面量真折叠 + 非法 base64
    //   记 InvalidCharacterError（env 旧声明把宿主异常 catch 掉 ⇒ 恒不抛）。
    // - TextDecoder → core 的 makeTextDecoderAbs：非法 label 记 RangeError
    //   （env 旧声明把它遮蔽成 TypeError）。
    // - TextEncoder/TextDecoder 是 JS **类**：裸调用原生必抛 TypeError
    //   （"Class constructor … cannot be invoked without 'new'"），env 旧声明
    //   把它们建模成普通可调用函数 ⇒ 恒不抛（假绿）。

    localStorage: Storage,
    sessionStorage: Storage,

    // Bug 862：document 成员表补齐（DOM 规范面）——闭 obj 缺槽 ⇒ 成员读出
    // **exact undefined** ⇒ 调用即「确定抛 TypeError」（假红）。
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
      // 类数组（HTMLCollection / NodeList）按数组面建模。
      getElementsByTagName: envFn([prim.str()], arrOf(prim.unknown)),
      getElementsByClassName: envFn([prim.str()], arrOf(prim.unknown)),
      getElementsByName: envFn([prim.str()], arrOf(prim.unknown)),
      createElement: envFn([prim.str()], prim.unknown),
      createTextNode: envFn([prim.str()], prim.unknown),
      forms: arrOf(prim.unknown),
      links: arrOf(prim.unknown),
      images: arrOf(prim.unknown),
      scripts: arrOf(prim.unknown),
      write: envFn([prim.unknown], undef()),
      open: envFn([prim.unknown], prim.unknown),
      close: envFn([], undef()),
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
      // Bug 872：NavigatorID mixin 成员——缺槽读出 exact undefined ⇒
      // `navigator.hardwareConcurrency > 4` 折成**恒 false**（错值，不抛）。
      hardwareConcurrency: prim.num(),
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
      // Bug 930：Location 实例恒带 searchParams（URLSearchParams）——缺槽 ⇒
      // `location.searchParams.get("q")` 被判「确定抛 TypeError」（假红）。
      searchParams: URLSearchParams,
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

    // Bug 860：EventTarget / Event / CustomEvent 都是构造器 ⇒ 带 ctor: true。
    EventTarget: envFn([], EventTarget, undefined, {
      name: "EventTarget", ctor: true,
    }),
    Event: envFn([prim.str(), prim.unknown], EventInstance, undefined, {
      name: "Event", ctor: true,
    }),
    CustomEvent: envFn([prim.str(), prim.unknown], CustomEventInstance, undefined, {
      name: "CustomEvent", ctor: true,
    }),

    // Bug 884（web 侧）：`structuredClone` 的 env 声明**删掉** ⇒ 回落宿主
    // 内建 ⇒ 宿主的 throws 面（不可克隆值抛 DOMException/DataCloneError）
    // 不会被 env 声明整段吃掉（旧声明恒记「不抛」⇒ L2 门禁假绿）。
    // node 侧同款修法见 `packages/env/src/node.ts`（Bug 884）。

    // Bug 862：performance 成员表补齐（Performance Level 2 面）——缺槽读出
    // exact undefined ⇒ 调用即「确定抛 TypeError」（假红）。
    performance: objAbs({
      now: envFn([], prim.num()),
      mark: envFn([prim.str()], undef()),
      measure: envFn([prim.str(), prim.str(), prim.str()], prim.unknown),
      getEntries: envFn([], arrOf(prim.unknown)),
      getEntriesByName: envFn([prim.str()], arrOf(prim.unknown)),
      getEntriesByType: envFn([prim.str()], arrOf(prim.unknown)),
      clearMarks: envFn([], undef()),
      clearMeasures: envFn([], undef()),
      clearResourceTimings: envFn([], undef()),
      toJSON: envFn([], prim.unknown),
      navigation: prim.unknown,
      serverTiming: prim.unknown,
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

    // ── Bug 870：浏览器全局清单补齐 ──────────────────────────────
    // 未声明的名字在引擎里是**未绑定** ⇒ 读它 = ReferenceError（假红），
    // 且诊断文案指向完全无关的方向（「re-export 不是局部绑定」）。
    // 以下全局在 node 宿主里不存在，但 web env 是给**浏览器代码**用的——
    // 声明它们不影响 node 路径。
    alert: envFn([prim.unknown], undef()),
    screen: objAbs({
      width: prim.num(),
      height: prim.num(),
      availWidth: prim.num(),
      availHeight: prim.num(),
      colorDepth: prim.num(),
      pixelDepth: prim.num(),
      orientation: prim.unknown,
    }),
    DOMParser: envFn([prim.unknown], DOMParserInstance, undefined, {
      name: "DOMParser", ctor: true,
    }),
    XMLHttpRequest: envFn([prim.unknown], XMLHttpRequestInstance, undefined, {
      name: "XMLHttpRequest", ctor: true,
    }),
    Worker: envFn([prim.unknown], WorkerInstance, undefined, {
      name: "Worker", ctor: true,
    }),
    FileReader: envFn([prim.unknown], FileReaderInstance, undefined, {
      name: "FileReader", ctor: true,
    }),

    // Bug 870 扩围（同一机制，源自 Bug 865 的扩围段）：另 5 个**真实存在**的
    // 浏览器全局，同样因「未声明」被判 ReferenceError。
    matchMedia: envFn([prim.str()], prim.unknown),
    IntersectionObserver: envFn([prim.unknown], IntersectionObserverInstance, undefined, {
      name: "IntersectionObserver", ctor: true,
    }),
    getComputedStyle: envFn([prim.unknown], prim.unknown),
    indexedDB: objAbs({
      open: envFn([prim.str(), prim.unknown], prim.unknown),
      deleteDatabase: envFn([prim.str(), prim.unknown], prim.unknown),
      databases: envFn([], promiseOf(prim.unknown)),
      cmp: envFn([prim.unknown, prim.unknown], prim.num()),
    }),
    caches: objAbs({
      open: envFn([prim.str()], prim.unknown),
      has: envFn([prim.str()], prim.bool()),
      delete: envFn([prim.str()], prim.bool()),
      match: envFn([prim.unknown, prim.unknown], prim.unknown),
      keys: envFn([prim.str()], promiseOf(prim.unknown)),
    }),
  };

  return {
    globals: { ...esEnv.globals, ...webGlobals },
  };
}
