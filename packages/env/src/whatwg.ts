/**
 * WHATWG 标准全局的 env 声明**单源**（web.ts 与 node.ts 此前各持一份逐字
 * 拷贝——Bug 870 / 族 15 · BUG-153 在两侧各修过一轮，靠本模块收口防再漂移）。
 *
 * **收录纪律**（byte-parity 硬约束）：只收「两侧逐字节同构」的声明，或
 * 「共享基底 + 逐侧注入差异位」能精确重建两侧原值的声明（注入位在签名里
 * 显式可见）。两侧**刻意分叉**的留在各 env 文件原地处，注明分叉原因：
 * - Response / Request / fetch / Headers：web 是 body 读取族带 TypeError
 *   拒绝 reason 的宽面，node 是品牌精确面（静态工厂/ branded 返回），
 *   且 Headers 槽序、forEach 形参类型、ctor 形参标签三处都不同；
 * - ReadableStream / WritableStream 实例槽表：node 品牌精确面
 *   （pipeThrough/tee 带 brand、有 `values`），web 宽面（有 `write`）；
 * - crypto / performance / URLSearchParams / Storage / setTimeout 族 /
 *   AbortController / AbortSignal / PerformanceMark：两侧值域不同
 *   （node perf_hooks / Timeout / 品牌静态面 vs web 规范面）。
 *
 * 收敛改动的验收 = parity dump（全局名 → brand → 排序槽键 + 全结构指纹）
 * 改前/改后 diff 为空。
 */

import { type Abs } from "@nudojs/core";
import {
  arrOf,
  brandOf,
  envFn,
  eventInstanceSlots,
  objAbs,
  prim,
  promiseOf,
  tupleOf,
  undef,
} from "./abs-helpers.ts";

/**
 * 迭代器面（族 15 · BUG-154）：WHATWG 的 `Headers.keys/values/entries()`、
 * `FormData.*`、`URLSearchParams.*` 返回**迭代器**（`Iterator`），**不是数组**。
 *
 * - 旧 node 面声明成 `arrOf(...)` ⇒ `Array.isArray(h.keys())` 被折成
 *   **`true`**（宿主 `false`）、`k.length` 折成 `number`（宿主 `undefined`）
 *   ⇒ **自信的错值**（假绿）；
 * - 旧 web 面声明成 `prim.unknown` ⇒ 可迭代性分类落 "may" ⇒
 *   `[...h.keys()]` 记 may-throw TypeError（假红）。
 *
 * 迭代器面 = **带 `@@iterator` 槽的 obj**：core 的 `iterabilityKind` 对
 * 「有 `@@iterator` 槽的闭 obj」判 **total**（可迭代、不抛），且
 * `Array.isArray` 为 false、`length` 不可得 ⇒ 与宿主一致。
 */
export function whatwgIteratorOf(element: Abs): Abs {
  return objAbs({
    next: envFn([], objAbs({ value: element, done: prim.bool() })),
    "@@iterator": envFn([], prim.unknown),
  });
}

/**
 * `PerformanceEntry` 实例槽表（`PerformanceMark` / `PerformanceMeasure` 共用
 * 基底；族 15 · BUG-149）。槽序（name → entryType → startTime → duration →
 * toJSON）是展示序——消费方在**尾部**扩展 `detail` 时保持本序不变。
 */
export function whatwgPerformanceEntrySlots(): Record<string, Abs> {
  return {
    name: prim.str(),
    entryType: prim.str(),
    startTime: prim.num(),
    duration: prim.num(),
    toJSON: envFn([], prim.unknown),
  };
}

/**
 * `Blob` 构造器全局（族 15 · BUG-153：未声明的浏览器标准全局落 core 的
 * 「未建模 brand」兜底 ⇒ 成员读折 exact `undefined` ⇒ 调用判「确定抛
 * TypeError」假红。宿主实测反例：`new Blob([]).slice()` 返回 Blob）。
 */
export function whatwgBlobCtorGlobal(): Abs {
  return envFn(
    [arrOf(prim.unknown), prim.unknown],
    brandOf(
      "Blob",
      objAbs({
        type: prim.str(),
        size: prim.num(),
        slice: envFn([prim.num(), prim.num(), prim.str()], brandOf("Blob")),
        arrayBuffer: envFn([], promiseOf(brandOf("ArrayBuffer"))),
        text: envFn([], promiseOf(prim.str())),
        bytes: envFn([], promiseOf(arrOf(prim.num()))),
        stream: envFn([], brandOf("ReadableStream")),
      }),
    ),
    undefined,
    { name: "Blob", ctor: true, params: ["parts", "options?"] },
  );
}

/** `URLPattern` 构造器全局（WHATWG URL Pattern；两侧逐字节同构）。 */
export function whatwgUrlPatternCtorGlobal(): Abs {
  return envFn(
    [prim.unknown, prim.str()],
    brandOf(
      "URLPattern",
      objAbs({
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
      }),
    ),
    undefined,
    { name: "URLPattern", ctor: true, params: ["input?", "baseURL?"] },
  );
}

/** `DisposableStack` 构造器全局（Explicit Resource Management；两侧同构）。 */
export function whatwgDisposableStackCtorGlobal(): Abs {
  return envFn(
    [prim.unknown],
    brandOf(
      "DisposableStack",
      objAbs({
        use: envFn([prim.unknown], prim.unknown),
        adopt: envFn([prim.unknown, prim.unknown], prim.unknown),
        defer: envFn([prim.unknown], undef()),
        move: envFn([], brandOf("DisposableStack")),
        dispose: envFn([], undef()),
        disposed: prim.bool(),
      }),
    ),
    undefined,
    { name: "DisposableStack", ctor: true, params: ["options?"] },
  );
}

/** `AsyncDisposableStack` 构造器全局（Explicit Resource Management；两侧同构）。 */
export function whatwgAsyncDisposableStackCtorGlobal(): Abs {
  return envFn(
    [prim.unknown],
    brandOf(
      "AsyncDisposableStack",
      objAbs({
        use: envFn([prim.unknown], prim.unknown),
        adopt: envFn([prim.unknown, prim.unknown], prim.unknown),
        defer: envFn([prim.unknown], undef()),
        move: envFn([], brandOf("AsyncDisposableStack")),
        disposeAsync: envFn([], promiseOf(prim.unknown)),
        disposed: prim.bool(),
      }),
    ),
    undefined,
    { name: "AsyncDisposableStack", ctor: true, params: ["options?"] },
  );
}

/** 流的 reader / writer 构造器全局（WHATWG Streams；两侧逐字节同构）。 */
export function whatwgReadableStreamDefaultReaderCtorGlobal(): Abs {
  return envFn(
    [brandOf("ReadableStream")],
    brandOf(
      "ReadableStreamDefaultReader",
      objAbs({
        closed: promiseOf(prim.unknown),
        read: envFn([], promiseOf(prim.unknown)),
        cancel: envFn([prim.unknown], promiseOf(prim.unknown)),
        releaseLock: envFn([], undef()),
      }),
    ),
    undefined,
    { name: "ReadableStreamDefaultReader", ctor: true, params: ["stream"] },
  );
}

/** 流的 BYOB reader 构造器全局（WHATWG Streams；两侧逐字节同构）。 */
export function whatwgReadableStreamByobReaderCtorGlobal(): Abs {
  return envFn(
    [brandOf("ReadableStream")],
    brandOf(
      "ReadableStreamBYOBReader",
      objAbs({
        closed: promiseOf(prim.unknown),
        read: envFn([arrOf(prim.num())], promiseOf(prim.unknown)),
        cancel: envFn([prim.unknown], promiseOf(prim.unknown)),
        releaseLock: envFn([], undef()),
      }),
    ),
    undefined,
    { name: "ReadableStreamBYOBReader", ctor: true, params: ["stream"] },
  );
}

/** 流的 writer 构造器全局（WHATWG Streams；两侧逐字节同构）。 */
export function whatwgWritableStreamDefaultWriterCtorGlobal(): Abs {
  return envFn(
    [brandOf("WritableStream")],
    brandOf(
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
    ),
    undefined,
    { name: "WritableStreamDefaultWriter", ctor: true, params: ["stream"] },
  );
}

/**
 * `FormData` 构造器全局。唯一注入位 = `forEach` 回调形参类型：
 * web 传 `prim.unknown`（规范宽面），node 传 `callbackFnBrand`
 * （node env 的回调/高阶 fn 角色品牌约定）。其余逐字节同构。
 */
export function whatwgFormDataCtorGlobal(forEachArg: Abs): Abs {
  return envFn(
    [prim.unknown],
    brandOf(
      "FormData",
      objAbs({
        append: envFn([prim.str(), prim.unknown], undef()),
        delete: envFn([prim.str()], undef()),
        get: envFn([prim.str()], prim.unknown),
        getAll: envFn([prim.str()], arrOf(prim.unknown)),
        has: envFn([prim.str()], prim.bool()),
        set: envFn([prim.str(), prim.unknown], undef()),
        // BUG-154：迭代器面（不是数组，见 whatwgIteratorOf）
        keys: envFn([], whatwgIteratorOf(prim.str())),
        values: envFn([], whatwgIteratorOf(prim.unknown)),
        entries: envFn([], whatwgIteratorOf(tupleOf([prim.str(), prim.unknown]))),
        forEach: envFn([forEachArg], undef()),
      }),
    ),
    undefined,
    { name: "FormData", ctor: true, params: ["form?"] },
  );
}

/**
 * `BroadcastChannel` 构造器全局。node 通过 `extraTailSlots` **尾部追加**
 * `ref` / `unref`（node 生命周期 API，浏览器无）⇒ web 侧槽序原样。
 */
export function whatwgBroadcastChannelCtorGlobal(
  extraTailSlots?: Record<string, Abs>,
): Abs {
  return envFn(
    [prim.str()],
    brandOf(
      "BroadcastChannel",
      objAbs({
        name: prim.str(),
        onmessage: prim.unknown,
        onmessageerror: prim.unknown,
        postMessage: envFn([prim.unknown], undef()),
        close: envFn([], undef()),
        ...(extraTailSlots ?? {}),
      }),
    ),
    undefined,
    { name: "BroadcastChannel", ctor: true, params: ["name"] },
  );
}

/**
 * `EventTarget` 槽表（EventTarget / AbortSignal / MessagePort / WebSocket
 * 共用继承面）。注入位：`listenerArg`（web `prim.unknown`；node
 * `callbackFnBrand`——回调形参的品牌约定）与可选的监听器形参标签
 * （node 标 `["type", "listener"]`，web 用 envFn 缺省 `x0/x1`）。
 */
export function whatwgEventTargetSlots(
  listenerArg: Abs,
  listenerLabels?: string[],
): Record<string, Abs> {
  return {
    addEventListener: envFn(
      [prim.str(), listenerArg],
      undef(),
      undefined,
      listenerLabels ? { params: listenerLabels } : undefined,
    ),
    removeEventListener: envFn(
      [prim.str(), listenerArg],
      undef(),
      undefined,
      listenerLabels ? { params: listenerLabels } : undefined,
    ),
    dispatchEvent: envFn([prim.unknown], prim.bool()),
  };
}

/** `EventTarget` 构造器全局（Bug 860：浏览器构造器必须带 `ctor: true`）。 */
export function whatwgEventTargetCtorGlobal(
  listenerArg: Abs,
  listenerLabels?: string[],
): Abs {
  return envFn(
    [],
    brandOf("EventTarget", objAbs(whatwgEventTargetSlots(listenerArg, listenerLabels))),
    undefined,
    { name: "EventTarget", ctor: true },
  );
}

/**
 * `Event` 构造器全局。实例面单源 = abs-helpers `eventInstanceSlots`
 * （Bug 860 / 族 15 · BUG-148）；唯一注入位 = ctor 形参标签（node 标
 * `["type", "options?"]`，web 用 envFn 缺省 `x0/x1`——展示元数据，不并轨）。
 */
export function whatwgEventCtorGlobal(params?: string[]): Abs {
  return envFn(
    [prim.str(), prim.unknown],
    brandOf("Event", objAbs(eventInstanceSlots())),
    undefined,
    { name: "Event", ctor: true, ...(params ? { params } : {}) },
  );
}

/**
 * `CustomEvent` 构造器全局：Event 继承面 + `detail`（DOM `CustomEvent : Event`，
 * 族 15 · BUG-148——品牌不得只列部分槽，否则成员读出 exact undefined ⇒ 假红）。
 */
export function whatwgCustomEventCtorGlobal(params?: string[]): Abs {
  return envFn(
    [prim.str(), prim.unknown],
    brandOf("CustomEvent", objAbs({ ...eventInstanceSlots(), detail: prim.unknown })),
    undefined,
    { name: "CustomEvent", ctor: true, ...(params ? { params } : {}) },
  );
}
