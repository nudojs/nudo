/**
 * Web env：es globals + Fetch/URL/DOM（Abs 原生）。
 */

import { type Abs, type AbsSigImpl, strLit, numLit } from "@nudojs/core";
import { absStrLit } from "@nudojs/core/internal";
import {
  arrOf,
  brandOf,
  envFn,
  errBrand,
  nullLit,
  objAbs,
  promiseOf,
  tupleOf,
  undef,
  unionOf,
  prim,
} from "./abs-helpers.ts";
import { type EnvDefinition, defineEnv as defineEsEnv } from "./es.ts";

export type { EnvDefinition };

function makeURLObj(url: URL): Abs {
  return brandOf("URL", objAbs({
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
  }));
}

export function defineEnv(): EnvDefinition {
  const esEnv = defineEsEnv();

  /**
   * 迭代器面（族 15 · BUG-154）：WHATWG 的 `Headers.keys/values/entries()`、
   * `FormData.*`、`URLSearchParams.*` 返回**迭代器**（`Iterator`），**不是数组**。
   *
   * 旧 web 面声明成 `prim.unknown` ⇒ core 的可迭代性分类落 "may" ⇒
   * `[...h.keys()]` 记 **may-throw TypeError**（假红，挡住合法的 `for…of` /
   * 展开）；node 面则相反地声明成数组（`Array.isArray` 折 `true`，自信错值）。
   *
   * 迭代器面 = **带 `@@iterator` 槽的 obj**：core 的 `iterabilityKind` 对
   * 「有 `@@iterator` 槽的闭 obj」判 **total**（可迭代、不抛）。
   */
  const iteratorOf = (element: Abs): Abs =>
    objAbs({
      next: envFn([], objAbs({ value: element, done: prim.bool() })),
      "@@iterator": envFn([], prim.unknown),
    });

  /**
   * 族 15 · BUG-161：浏览器构造器的实例面**必须带 brand**（`brandOf(...)`）。
   *
   * 旧面全部是 `objAbs(...)`（普通对象面、无 brand）⇒ `new Event("t")` 的值
   * 是闭 obj ⇒ `instanceof Event` **恒 false**、`constructor.name` 恒
   * `"Object"` ⇒ 与宿主**相反**（宿主恒 true / `"Event"`）⇒ 真实分支被消成
   * 死代码。node env 的全部构造器都是 brand ⇒ 两 env 结论相反。
   */
  const Headers = brandOf("Headers", objAbs({
    append: envFn([prim.str(), prim.str()], undef()),
    delete: envFn([prim.str()], undef()),
    get: envFn([prim.str()], unionOf(prim.str(), nullLit())),
    has: envFn([prim.str()], prim.bool()),
    set: envFn([prim.str(), prim.str()], undef()),
    // 族 15 · BUG-148：`Headers.getSetCookie()` 是 WHATWG Fetch 标准成员
    // （node v26 / 浏览器都有；node env 早已声明）⇒ 缺槽 ⇒
    // `new Headers().getSetCookie()` 判「确定抛 TypeError」（假红）。
    getSetCookie: envFn([], arrOf(prim.str())),
    forEach: envFn([prim.unknown], undef()),
    entries: envFn([], iteratorOf(tupleOf([prim.str(), prim.str()]))),
    keys: envFn([], iteratorOf(prim.str())),
    values: envFn([], iteratorOf(prim.str())),
  }));

  /**
   * Request / Response **共有**面（Bug 887）：body 读取族 + headers/url/bodyUsed。
   *
   * `bodyUsed` 两侧都有（WHATWG Fetch `Request.bodyUsed` / `Response.bodyUsed`
   * 各一；node v26 undici 实测 `new Request(u).bodyUsed` 存在）⇒ 归共有面，
   * **不是** Response 专有。
   *
   * 族 62（Bug 890 精度）：body 读取族的**拒绝 reason = TypeError**
   * （WHATWG Fetch「consume body」：body 流出错 / JSON 解析失败 ⇒ 抛
   * TypeError；node v26 undici 实测 `await res.json()` 遇非法 JSON ⇒
   * `TypeError: Unexpected token …`）。此前 reason 是 `unknown` ⇒
   * `catch (e) { e.message }` 拿不到东西。
   */
  const bodyReadSlots = {
    json: envFn([], promiseOf(prim.unknown, errBrand("TypeError"))),
    text: envFn([], promiseOf(prim.str(), errBrand("TypeError"))),
    arrayBuffer: envFn([], promiseOf(prim.unknown, errBrand("TypeError"))),
    blob: envFn([], promiseOf(prim.unknown, errBrand("TypeError"))),
    formData: envFn([], promiseOf(prim.unknown, errBrand("TypeError"))),
    clone: envFn([], prim.unknown),
    headers: Headers,
    url: prim.str(),
    bodyUsed: prim.bool(),
    // 族 15 · BUG-148：`body` 是 WHATWG Fetch 的标准成员（`ReadableStream |
    // null`；node env 早已声明）⇒ 缺槽 ⇒ `new Response("hi").body.getReader()`
    // 读出 **exact undefined** ⇒ 判「确定抛 TypeError」（假红）。
    body: prim.unknown,
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

  const Response = brandOf("Response", objAbs({ ...bodyReadSlots, ...responseStatusSlots }));

  /**
   * Request **自有**成员表（Bug 887）：**不**展开 Response 的状态面
   * （原生读出恒 `undefined`）⇒ 展开即错值。
   */
  const Request = brandOf("Request", objAbs({
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
  }));

  /**
   * ⚠️ `URLSearchParams` 是 **12+1** 里的例外：core 按 **brand 名**路由内建
   * 建模（实测 `brandOf("URLSearchParams", objAbs({ get … }))` 读 `.get` 折
   * **unknown**，env 的槽表被忽略）⇒ 加 brand 会丢掉 `get` 的
   * `string | null` 精确面（`env-bug-930` 回归）。
   * ⇒ 暂保持**无 brand**（`instanceof URLSearchParams` 仍是 false，属 core
   * 的品牌派发面缺陷，env 侧无法修）；其余 12 个浏览器构造器已全部带 brand。
   */
  const URLSearchParams = objAbs({
    append: envFn([prim.str(), prim.str()], undef()),
    delete: envFn([prim.str()], undef()),
    get: envFn([prim.str()], unionOf(prim.str(), nullLit())),
    getAll: envFn([prim.str()], arrOf(prim.str())),
    has: envFn([prim.str()], prim.bool()),
    set: envFn([prim.str(), prim.str()], undef()),
    sort: envFn([], undef()),
    toString: envFn([], prim.str()),
    // 族 15 · BUG-154：迭代器面（不是数组，见 iteratorOf）
    entries: envFn([], iteratorOf(tupleOf([prim.str(), prim.str()]))),
    keys: envFn([], iteratorOf(prim.str())),
    values: envFn([], iteratorOf(prim.str())),
    forEach: envFn([prim.unknown], undef()),
    size: prim.num(),
  });

  const URLObj = brandOf("URL", objAbs({
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
  }));

  const AbortController = brandOf("AbortController", objAbs({
    signal: prim.unknown,
    abort: envFn([], undef()),
  }));

  const Storage = objAbs({
    getItem: envFn([prim.str()], unionOf(prim.str(), nullLit())),
    setItem: envFn([prim.str(), prim.str()], undef()),
    removeItem: envFn([prim.str()], undef()),
    clear: envFn([], undef()),
    key: envFn([prim.num()], unionOf(prim.str(), nullLit())),
    length: prim.num(),
  });

  const EventTarget = brandOf("EventTarget", objAbs({
    addEventListener: envFn([prim.str(), prim.unknown], undef()),
    removeEventListener: envFn([prim.str(), prim.unknown], undef()),
    dispatchEvent: envFn([prim.unknown], prim.bool()),
  }));

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

  const EventInstance = brandOf("Event", objAbs(eventSlots));

  /** CustomEvent 实例面：Event 共有面 + `detail`（DOM `CustomEvent`）。 */
  const CustomEventInstance = brandOf("CustomEvent", objAbs({ ...eventSlots, detail: prim.unknown }));

  /**
   * 浏览器构造器实例面（Bug 870）。
   */
  const DOMParserInstance = brandOf("DOMParser", objAbs({
    parseFromString: envFn([prim.str(), prim.str()], prim.unknown),
  }));

  const XMLHttpRequestInstance = brandOf("XMLHttpRequest", objAbs({
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
  }));

  const WorkerInstance = brandOf("Worker", objAbs({
    postMessage: envFn([prim.unknown], undef()),
    terminate: envFn([], undef()),
    onmessage: prim.unknown,
    onerror: prim.unknown,
    onmessageerror: prim.unknown,
    addEventListener: envFn([prim.str(), prim.unknown], undef()),
    removeEventListener: envFn([prim.str(), prim.unknown], undef()),
  }));

  const FileReaderInstance = brandOf("FileReader", objAbs({
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
  }));

  const IntersectionObserverInstance = brandOf("IntersectionObserver", objAbs({
    observe: envFn([prim.unknown], undef()),
    unobserve: envFn([prim.unknown], undef()),
    disconnect: envFn([], undef()),
    takeRecords: envFn([], arrOf(prim.unknown)),
  }));

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

  /**
   * `Location` 实例面——**独立全局** `location` 与 `document.location`
   * **同源**（DOM：`document.location === location`）。
   *
   * 族 15 · BUG-148：旧面只在**独立全局**处内联了一份 ⇒ `document.location`
   * 不在 document 槽表里 ⇒ 读出 **exact `undefined`** ⇒
   * `document.location.href` 判「确定抛 TypeError」（L2 假红），而同一个文件
   * 里的 `document.title` 是绿的（列了 `title`）⇒ 系统性漏槽。
   */
  const Location = objAbs({
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
  });

  /**
   * `PerformanceEntry` 实例面（`PerformanceMark` / `PerformanceMeasure` 共用）。
   *
   * 族 15 · BUG-149：web env 的 `performance.mark` **返回类型被写死成
   * `undefined`**（`mark: envFn([prim.str()], undef())`），而宿主返回
   * `PerformanceMark`（`.name` 是 string）⇒ `m.name` 读在 undefined 上
   * ⇒ 判「确定抛 TypeError」（L2 假红）；node env 同 API 声明是
   * `brandOf("PerformanceMark")` ⇒ 两 env 互斥。
   */
  const performanceEntrySlots = {
    name: prim.str(),
    entryType: prim.str(),
    startTime: prim.num(),
    duration: prim.num(),
    toJSON: envFn([], prim.unknown),
  };

  /**
   * WebCrypto 成员声明（族 15 · BUG-150）。
   *
   * **静态**声明保持 `OperationError`（WebCrypto Level 1/2 的规范面：
   * digest / encrypt / decrypt / sign / verify / generateKey / deriveKey /
   * deriveBits / wrapKey / unwrapKey / exportKey 的「执行失败」原因）。
   *
   * **调用面**的拒绝 reason = `OperationError ∪ TypeError`——参数类型非法
   * （非 BufferSource / 非 CryptoKey / 非整数）时宿主的拒绝是 **`TypeError`**
   * （node v26 实测 `crypto.subtle.encrypt("AES-GCM", 1, 2)` ⇒
   * `e.name === "TypeError"`）。旧面把**整族**一刀切成 `OperationError`
   * ⇒ `catch (e) { if (e.name === "TypeError") … }` 的**真分支被判不可达**
   * ⇒ 分支体从签名面消失 ⇒ **假绿**（用户会以为那段是废代码而删掉）。
   */
  const webCryptoFn = (paramTypes: Abs[], ret: Abs, staticReason?: Abs): Abs =>
    staticReason === undefined
      ? // `unknown` 已经覆盖全部拒绝路径（含 TypeError）⇒ 调用面同样保持 unknown
        envFn(paramTypes, promiseOf(ret))
      : envFn(paramTypes, promiseOf(ret, staticReason), () =>
          promiseOf(ret, unionOf(errBrand("OperationError"), errBrand("TypeError"))),
        );

  /**
   * 流实例面（`ReadableStream` / `WritableStream` 共用；族 15 · BUG-153）。
   * 与 node env 的 `streamSlots` 同源——两 env 对同一标准 API 必须一致。
   */
  const streamInstanceSlots = {
    locked: prim.bool(),
    cancel: envFn([prim.unknown], undef()),
    close: envFn([], undef()),
    abort: envFn([prim.unknown], undef()),
    getReader: envFn([], brandOf("ReadableStreamDefaultReader")),
    getWriter: envFn([], brandOf("WritableStreamDefaultWriter")),
    pipeTo: envFn([prim.unknown], promiseOf(prim.unknown)),
    pipeThrough: envFn([prim.unknown, prim.unknown], prim.unknown),
    tee: envFn([], arrOf(prim.unknown)),
    write: envFn([prim.unknown], promiseOf(prim.unknown)),
  };

  const webGlobals: Record<string, Abs> = {
    // 族 62（Bug 890 精度）：`fetch` 的**拒绝 reason** = TypeError ∪ AbortError
    // （WHATWG Fetch「fetch」：网络错 / 非法 URL ⇒ TypeError；`signal` 被 abort
    // ⇒ 以 abort reason 拒绝，默认 abort reason 是 `AbortError` DOMException）。
    // ⚠️ 已知偏差：**自定义** abort reason（`controller.abort("x")`）不在建模
    // 范围 ⇒ 该路径的 reason 实际比声明宽（见交回报告）。
    fetch: envFn(
      [unionOf(prim.str(), Request)],
      promiseOf(Response, unionOf(errBrand("TypeError"), errBrand("AbortError"))),
    ),
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
      // 族 15 · BUG-148：`document.location` 与独立全局 `location` 同一对象
      // （DOM 规范）；旧槽表里没有它 ⇒ `document.location.href` 判「确定抛
      // TypeError」（假红），而 `document.title` 是绿的。
      location: Location,
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
      // Bug 1048 同源：Web Locks API（**W3C 标准**，浏览器 + node 24+ 都有）——
      // 缺槽读出 exact undefined ⇒ `navigator.locks.request(...)` 判「确定抛
      // TypeError」（假红）。宿主实测：`navigator.locks` 原型成员 =
      // `constructor, request, query`。
      locks: objAbs({
        query: envFn([], promiseOf(prim.unknown)),
        request: envFn([prim.unknown, prim.unknown], promiseOf(prim.unknown)),
      }),
      clipboard: objAbs({
        // 族 62（Bug 890 精度）：Clipboard API 的**拒绝 reason = NotAllowedError**
        // （W3C Clipboard API：权限被拒 / 文档非 fully active ⇒ 以
        // `NotAllowedError` DOMException 拒绝）。
        readText: envFn([], promiseOf(prim.str(), errBrand("NotAllowedError"))),
        writeText: envFn([prim.str()], promiseOf(undef(), errBrand("NotAllowedError"))),
      }),
    }),
    location: Location,
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
      // 族 15 · BUG-149：mark / measure 返回 PerformanceMark / PerformanceMeasure
      // （宿主实测 `performance.mark("start").constructor.name ===
      // "PerformanceMark"`、`.name === "start"`）——不是 undefined / unknown。
      mark: envFn([prim.str()], brandOf("PerformanceMark", objAbs(performanceEntrySlots))),
      measure: envFn(
        [prim.str(), prim.str(), prim.str()],
        brandOf("PerformanceMeasure", objAbs(performanceEntrySlots)),
      ),
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
        // 族 62（Bug 890 精度）+ 族 15（BUG-150）：静态 reason 是
        // `OperationError`（WebCrypto 规范面），**调用面** reason 放宽为
        // `OperationError ∪ TypeError`（参数非法时宿主给的是 TypeError）。
        // ⚠️ `importKey` 例外：静态声明保持 `unknown`（可能以 `DataError` /
        // `NotSupportedError` 拒绝，不止一种 ⇒ 不假精确）。
        digest: webCryptoFn([prim.str(), prim.unknown], prim.unknown, errBrand("OperationError")),
        encrypt: webCryptoFn(
          [prim.unknown, prim.unknown, prim.unknown],
          prim.unknown,
          errBrand("OperationError"),
        ),
        decrypt: webCryptoFn(
          [prim.unknown, prim.unknown, prim.unknown],
          prim.unknown,
          errBrand("OperationError"),
        ),
        sign: webCryptoFn(
          [prim.unknown, prim.unknown, prim.unknown],
          prim.unknown,
          errBrand("OperationError"),
        ),
        verify: webCryptoFn(
          [
            prim.unknown,
            prim.unknown,
            prim.unknown,
            prim.unknown,
          ],
          prim.bool(),
          errBrand("OperationError"),
        ),
        generateKey: webCryptoFn(
          [prim.unknown, prim.bool(), arrOf(prim.str())],
          prim.unknown,
          errBrand("OperationError"),
        ),
        // Bug 1049：WebCrypto Level 1 / Level 2 标准 API——旧表只有 8 个键
        // ⇒ 缺的这 4 个读出 **exact undefined** ⇒ 调用即「确定抛 TypeError」
        // ⇒ 合法浏览器代码被判「必抛」（L2 门禁假红）；node env 同一对象
        // 早已声明 `deriveKey` / `deriveBits` ⇒ 两 env 自相矛盾。补齐后
        // 两 env 的 `crypto.subtle` 成员集合同源。
        deriveKey: webCryptoFn(
          [
            prim.unknown,
            prim.unknown,
            prim.unknown,
            prim.bool(),
            arrOf(prim.str()),
          ],
          prim.unknown,
          errBrand("OperationError"),
        ),
        deriveBits: webCryptoFn(
          [prim.unknown, prim.unknown, prim.num()],
          prim.unknown,
          errBrand("OperationError"),
        ),
        wrapKey: webCryptoFn(
          [prim.unknown, prim.unknown, prim.unknown, prim.unknown],
          prim.unknown,
          errBrand("OperationError"),
        ),
        unwrapKey: webCryptoFn(
          [prim.unknown, prim.unknown, prim.unknown, prim.unknown],
          prim.unknown,
          errBrand("OperationError"),
        ),
        importKey: webCryptoFn(
          [
            prim.str(),
            prim.unknown,
            prim.unknown,
            prim.bool(),
            arrOf(prim.str()),
          ],
          // 静态拒绝 reason 有多种（DataError / NotSupportedError）⇒ unknown。
          prim.unknown,
        ),
        exportKey: webCryptoFn(
          [prim.str(), prim.unknown],
          prim.unknown,
          errBrand("OperationError"),
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

    // ── 族 15 · BUG-153：13 个**浏览器标准全局**在 web env 里根本没声明
    // ⇒ 落 core 的「未建模 brand」兜底 ⇒ **成员读折 exact `undefined`**
    // ⇒ 该全局的**全体**成员调用判「确定抛 TypeError」⇒ L2 门禁假红
    // （exit 1），而运行时完全正常；node env 早已声明（同一套 Web 标准面）。
    // 宿主实测反例：`new FormData().append("a","b")` 不抛、`new Blob([]).slice()`
    // 返回 Blob、`ReadableStream.prototype.cancel` 存在。
    Blob: envFn([arrOf(prim.unknown), prim.unknown], brandOf("Blob", objAbs({
      type: prim.str(),
      size: prim.num(),
      slice: envFn([prim.num(), prim.num(), prim.str()], brandOf("Blob")),
      arrayBuffer: envFn([], promiseOf(brandOf("ArrayBuffer"))),
      text: envFn([], promiseOf(prim.str())),
      bytes: envFn([], promiseOf(arrOf(prim.num()))),
      stream: envFn([], brandOf("ReadableStream")),
    })), undefined, { name: "Blob", ctor: true, params: ["parts", "options?"] }),

    BroadcastChannel: envFn([prim.str()], brandOf("BroadcastChannel", objAbs({
      name: prim.str(),
      onmessage: prim.unknown,
      onmessageerror: prim.unknown,
      postMessage: envFn([prim.unknown], undef()),
      close: envFn([], undef()),
    })), undefined, { name: "BroadcastChannel", ctor: true, params: ["name"] }),

    DisposableStack: envFn([prim.unknown], brandOf("DisposableStack", objAbs({
      use: envFn([prim.unknown], prim.unknown),
      adopt: envFn([prim.unknown, prim.unknown], prim.unknown),
      defer: envFn([prim.unknown], undef()),
      move: envFn([], brandOf("DisposableStack")),
      dispose: envFn([], undef()),
      disposed: prim.bool(),
    })), undefined, { name: "DisposableStack", ctor: true, params: ["options?"] }),

    AsyncDisposableStack: envFn([prim.unknown], brandOf("AsyncDisposableStack", objAbs({
      use: envFn([prim.unknown], prim.unknown),
      adopt: envFn([prim.unknown, prim.unknown], prim.unknown),
      defer: envFn([prim.unknown], undef()),
      move: envFn([], brandOf("AsyncDisposableStack")),
      disposeAsync: envFn([], promiseOf(prim.unknown)),
      disposed: prim.bool(),
    })), undefined, { name: "AsyncDisposableStack", ctor: true, params: ["options?"] }),

    FormData: envFn([prim.unknown], brandOf("FormData", objAbs({
      append: envFn([prim.str(), prim.unknown], undef()),
      delete: envFn([prim.str()], undef()),
      get: envFn([prim.str()], prim.unknown),
      getAll: envFn([prim.str()], arrOf(prim.unknown)),
      has: envFn([prim.str()], prim.bool()),
      set: envFn([prim.str(), prim.unknown], undef()),
      // BUG-154：迭代器面（不是数组，见 iteratorOf）
      keys: envFn([], iteratorOf(prim.str())),
      values: envFn([], iteratorOf(prim.unknown)),
      entries: envFn([], iteratorOf(tupleOf([prim.str(), prim.unknown]))),
      forEach: envFn([prim.unknown], undef()),
    })), undefined, { name: "FormData", ctor: true, params: ["form?"] }),

    PerformanceMark: envFn([prim.str(), prim.unknown], brandOf(
      "PerformanceMark",
      objAbs({ ...performanceEntrySlots, detail: prim.unknown }),
    ), undefined, { name: "PerformanceMark", ctor: true, params: ["name", "options?"] }),

    PerformanceObserver: envFn([prim.unknown], brandOf("PerformanceObserver", objAbs({
      observe: envFn([prim.unknown], undef()),
      disconnect: envFn([], undef()),
      takeRecords: envFn([], arrOf(brandOf("PerformanceEntry"))),
    })), undefined, { name: "PerformanceObserver", ctor: true, params: ["callback"] }),

    ReadableStream: envFn([prim.unknown, prim.unknown], brandOf(
      "ReadableStream",
      objAbs(streamInstanceSlots),
    ), undefined, { name: "ReadableStream", ctor: true, params: ["underlyingSource?", "strategy?"] }),

    WritableStream: envFn([prim.unknown, prim.unknown], brandOf(
      "WritableStream",
      objAbs(streamInstanceSlots),
    ), undefined, { name: "WritableStream", ctor: true, params: ["underlyingSink?", "strategy?"] }),

    ReadableStreamDefaultReader: envFn([brandOf("ReadableStream")], brandOf(
      "ReadableStreamDefaultReader",
      objAbs({
        closed: promiseOf(prim.unknown),
        read: envFn([], promiseOf(prim.unknown)),
        cancel: envFn([prim.unknown], promiseOf(prim.unknown)),
        releaseLock: envFn([], undef()),
      }),
    ), undefined, { name: "ReadableStreamDefaultReader", ctor: true, params: ["stream"] }),

    ReadableStreamBYOBReader: envFn([brandOf("ReadableStream")], brandOf(
      "ReadableStreamBYOBReader",
      objAbs({
        closed: promiseOf(prim.unknown),
        read: envFn([arrOf(prim.num())], promiseOf(prim.unknown)),
        cancel: envFn([prim.unknown], promiseOf(prim.unknown)),
        releaseLock: envFn([], undef()),
      }),
    ), undefined, { name: "ReadableStreamBYOBReader", ctor: true, params: ["stream"] }),

    WritableStreamDefaultWriter: envFn([brandOf("WritableStream")], brandOf(
      "WritableStreamDefaultWriter",
      objAbs({
        closed: promiseOf(prim.unknown),
        desiredSize: prim.num(),
        ready: promiseOf(prim.unknown),
        write: envFn([prim.unknown], promiseOf(prim.unknown)),
        close: envFn([], promiseOf(prim.unknown)),
        abort: envFn([prim.unknown], promiseOf(prim.unknown)),
        releaseLock: envFn([], undef()),
      }),
    ), undefined, { name: "WritableStreamDefaultWriter", ctor: true, params: ["stream"] }),

    URLPattern: envFn([prim.unknown, prim.str()], brandOf("URLPattern", objAbs({
      protocol: prim.str(),
      username: prim.str(),
      password: prim.str(),
      hostname: prim.str(),
      port: prim.str(),
      pathname: prim.str(),
      search: prim.str(),
      hash: prim.str(),
      hasRegExpGroups: prim.bool(),
      exec: envFn([prim.unknown], prim.unknown),
      test: envFn([prim.unknown], prim.bool()),
    })), undefined, { name: "URLPattern", ctor: true, params: ["input?", "baseURL?"] }),

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
