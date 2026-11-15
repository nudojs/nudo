/**
 * 模块套件：Node 宿主面（globals/process/fs/path/os/module/console/spawn/util）。
 */
import { describe, it, expect } from "vitest";
import { checkSource, pTrue, formatShape, type Abs, boolLit, objOf, strLit, numLit, $new, resetGeneralizeMemo, relationFn, instantiateReturn, undefAbs, abs, type AbsModuleExports, getFnImpl, unknown } from "@nudojs/core";
import { defineEnv } from "../node.ts";
import { execFileSync, spawnSync as nodeSpawnSync } from "node:child_process";
import { checkNode, staticSlotOf, nodeSlotOf, slotOfAbs, memberNames } from "./env-member-tables-helpers.ts";
import fs, { readFile } from "node:fs";
import fsp from "node:fs/promises";
import { callSite, envMember, innerOf, slotsOf, brandName, applyOut } from "./env-helpers-s3.ts";
import nodePath, { type FormatInputPathObject } from "node:path";
import { pathToFileURL as nodePathToFileURL } from "node:url";
import { callSite as callSite____env_bug_s4_helpers_ts, brandName as brandName____env_bug_s4_helpers_ts, callSite as callSite____env_bug_s4_helpers_ts_1, thrownBrand, brandName as brandName____env_bug_s4_helpers_ts_1, callSite as callSite____env_bug_s4_helpers_ts_2 } from "./env-helpers-s4.ts";
import os from "node:os";
import { runWithMayThrowSession, setMayThrowCollector } from "@nudojs/core/internal";
import { defineEnv as defineEnv_____es_ts } from "../es.ts";
import { checkWeb, webEnvGlobals } from "./env-helpers-s1.ts";
import { ok as nodeOk, strictEqual as nodeStrictEqual, fail as nodeFail } from "node:assert";
import { brandOf, objAbs, prim } from "../abs-helpers.ts";
import { inherits as nodeInherits, promisify as nodePromisify, types as hostTypes } from "node:util";

// ---------------------------------------------------------------------------
// node env 全局清单补齐（未建模构造器不再铸空 brand）
// ---------------------------------------------------------------------------
describe("node env 全局清单补齐（未建模构造器不再铸空 brand）", () => {
/**
 * env node：全局清单只覆盖 41/139；未建模的宿主构造器被 core 的
 * `$new` 兜底铸成**空 brand**（闭 obj 无槽）⇒ 成员读 exact undefined ⇒
 * 再链式读一次就成「定抛 TypeError」（假红）；未建模的**全局对象**
 * （crypto / performance / navigator …）退化成 unknown + 误导诊断
 * `nudo:unknown-inference`。
 *
 * 修法（packages/env/src/node.ts）：补齐 node 侧可构造/不可构造的宿主全局
 * 清单（ctor:true / ctor:false + 实例面 + 静态面），并补全局对象面。
 *
 * 证据口径：
 * - **原生 oracle**：本文件直接对真实 Node 运行时断言（同一进程内）。
 * - **引擎探针**：checkSource + node env globals ⇒ 签名 / 诊断。
 */





const env = defineEnv();

function globalOf(name: string): Abs {
  const g = env.globals[name];
  expect(g, `global "${name}" missing`).toBeTruthy();
  return g!;
}

function shapeOf(a: Abs | undefined, label: string): string {
  expect(a, `expected Abs at ${label}`).toBeTruthy();
  return formatShape(a!);
}

function walk(a: Abs | undefined, ...keys: string[]): Abs | undefined {
  let cur: Abs | undefined = a;
  for (const k of keys) {
    if (!cur) return undefined;
    if (cur.shape.k === "brand") cur = cur.shape.shape as Abs | undefined;
    if (!cur || cur.shape.k !== "obj") return undefined;
    cur = cur.shape.slots[k]?.value;
  }
  return cur;
}

/** 构造器的**实例面**（envFn 的 returnType） */
function instanceOf(a: Abs): Abs {
  return a.shape.k === "fn" && a.shape.returnType ? a.shape.returnType : a;
}

function check(src: string) {
  return checkSource("/t/env-bug-863.js", src, pTrue, {
    inject: { envGlobals: env.globals },
  });
}

describe("node env 全局清单补齐（未建模构造器不再铸空 brand）", () => {
  it("原生 oracle：报告点名的 17 个构造器在真实 Node 上确实存在", () => {
    // 报告的 17 个构造器（可构造的）+ 真实 Node 上确实可 new
    // 宿主版本漂移：直接引用标识符在缺席宿主上是 ReferenceError（URLPattern
    // 仅 Node 26 有）⇒ 统一从 globalThis 取值；缺席方向只跳过（不是建模缺陷），
    // 存在的构造器仍逐个钉 typeof === "function"。
    for (const name of [
      "AbortController", "Blob", "BroadcastChannel", "CustomEvent",
      "DOMException", "Event", "EventTarget", "File", "MessageChannel",
      "ReadableStream", "Request", "Response", "TransformStream",
      "URLPattern", "WritableStream",
    ] as const) {
      const ctor = (globalThis as Record<string, unknown>)[name];
      if (ctor === undefined) continue;
      expect(typeof ctor, name).toBe("function");
    }
    // 原生不可构造的（Illegal constructor / 不能 new）——引擎须同口径
    for (const name of ["AbortSignal", "MessagePort"] as const) {
      const ctor = (globalThis as Record<string, unknown>)[name];
      if (ctor === undefined) continue;
      expect(() => new (ctor as new () => unknown)()).toThrow(TypeError);
    }
  });

  it("env：17 个构造器全部声明，且可构造的带 ctor:true + 实例面", () => {
    const constructible = [
      "AbortController", "Blob", "BroadcastChannel", "CustomEvent", "DOMException",
      "Event", "EventTarget", "File", "MessageChannel", "ReadableStream",
      "Request", "Response", "TransformStream", "URLPattern", "WritableStream",
    ];
    for (const name of constructible) {
      const g = globalOf(name);
      expect(g.shape.k, `${name} 形状`).toBe("fn");
      expect((g.shape as { ctor?: boolean }).ctor, `${name} ctor`).toBe(true);
      expect(instanceOf(g).shape.k, `${name} 实例面`).toBe("brand");
    }
    // 原生不可构造 ⇒ env 侧 ctor:false（`new X()` 定抛 TypeError，同口径）
    for (const name of ["AbortSignal", "MessagePort"]) {
      expect((globalOf(name).shape as { ctor?: boolean }).ctor, name).toBe(false);
    }
  });

  it("env：全局对象面（crypto / performance / navigator）已声明且非 unknown", () => {
    expect(shapeOf(walk(globalOf("crypto"), "randomUUID"), "crypto.randomUUID")).toContain(
      "=>",
    );
    expect(shapeOf(walk(globalOf("performance"), "now"), "performance.now")).toContain(
      "=>",
    );
    expect(
      shapeOf(walk(globalOf("navigator"), "hardwareConcurrency"), "navigator.hardwareConcurrency"),
    ).toContain("number");
  });

  it("引擎探针：未建模构造器的成员读不再是 exact undefined（不再定抛 TypeError）", () => {
    const src = `
      export function bc() { return new BroadcastChannel("x").name; }
      export function mp() { return typeof new MessageChannel().port1.postMessage; }
      export function ws() { return typeof new WritableStream().getWriter; }
      export function ts() { return typeof new TransformStream().readable; }
      export function fl() { return new File([], "x").name; }
      export function et() { return typeof new EventTarget().dispatchEvent; }
      export function up() { return typeof new URLPattern({ pathname: "/a" }).test; }
      export function ac() { return typeof new AbortController().abort; }
      export function ru() { return crypto.randomUUID(); }
    `;
    const r = check(src);
    // 无 entry-may-throw 假红
    expect(r.issues.filter((i) => i.code === "nudo:entry-may-throw")).toEqual([]);
    // 无「把引擎债指向用户代码」的 unknown-inference
    expect(r.issues.filter((i) => i.code === "nudo:unknown-inference")).toEqual([]);
    const byName = new Map(r.signatures.map((s) => [s.name, s.display]));
    expect(byName.get("bc")).toMatch(/^string\b/);
    expect(byName.get("fl")).toMatch(/^string\b/);
    expect(byName.get("ru")).toMatch(/^string\b/);
    expect(byName.get("ws")).toMatch(/^"function"/);
    expect(byName.get("et")).toMatch(/^"function"/);
    expect(byName.get("up")).toMatch(/^"function"/);
    expect(byName.get("ac")).toMatch(/^"function"/);
  });

  it("原生 oracle：crypto.randomUUID() 恒返回 string（从不失败）", () => {
    expect(typeof crypto.randomUUID()).toBe("string");
  });
});
});

// ---------------------------------------------------------------------------
// node env declares host functions as functions
// ---------------------------------------------------------------------------
describe("node env declares host functions as functions", () => {
/**
 * 族 15 · node env 把宿主上的**函数 / 构造器**声明成 brand（数据值）：
 * - `AbortSignal.any`（静态工厂）⇒ `typeof` 折 `"object"`（宿主 `"function"`）；
 * - `WebAssembly.Module/Instance/Memory/Table/Global` 与
 * `Temporal.Instant/PlainDate/PlainTime/PlainDateTime/ZonedDateTime`
 * （可 `new` 的构造器）⇒ 同样折 `"object"`。
 *
 * 后果：`if (typeof X.y === "function")` 的特性探测分支被判**恒假**
 * ⇒ 用户会据此删掉真实有效的分支（自信的错字面量）。
 *
 * 反向钉：把任一声明改回 `brandOf(...)` ⇒ 对应 `typeof` 断言必挂。
 */
function host(script: string): string {
  return execFileSync(process.execPath, ["-e", script], { encoding: "utf-8" }).trim();
}

const MEMBERS: Array<[label: string, expr: string]> = [
  ["AbortSignal.any", "AbortSignal.any"],
  ["WebAssembly.Module", "WebAssembly.Module"],
  ["WebAssembly.Instance", "WebAssembly.Instance"],
  ["WebAssembly.Memory", "WebAssembly.Memory"],
  ["WebAssembly.Table", "WebAssembly.Table"],
  ["WebAssembly.Global", "WebAssembly.Global"],
  ["Temporal.Instant", "Temporal.Instant"],
  ["Temporal.PlainDate", "Temporal.PlainDate"],
  ["Temporal.PlainTime", "Temporal.PlainTime"],
  ["Temporal.PlainDateTime", "Temporal.PlainDateTime"],
  ["Temporal.ZonedDateTime", "Temporal.ZonedDateTime"],
];

/**
 * 宿主实测的成员 `typeof`；宿主**没有**该成员所属的根全局时为 `null`。
 *
 * 宿主面随 Node 版本漂移：`Temporal` 全局是 Node 26 才进 ESM 全局面的
 * （Node 24 没有）⇒ `typeof Temporal.Instant` 在旧宿主上直接 `ReferenceError`。
 * env 的 node 面按**最新宿主**声明 ⇒ `Temporal` 是登记过的「超前声明」
 * （见 env-的 `DECLARED_AHEAD_OF_HOST` 漂移闸）⇒ 宿主缺失按 `null` 记，
 * 不许让旧宿主把整个 oracle 炸掉。
 */
function hostMemberTypes(): Array<string | null> {
  const probes = MEMBERS.map(
    ([, e]) =>
      `(() => { const root = globalThis.${e.slice(0, e.indexOf("."))};` +
      ` return root === undefined ? null : typeof ${e}; })()`,
  );
  const out = host(`console.log(JSON.stringify([${probes.join(", ")}]));`);
  return JSON.parse(out) as Array<string | null>;
}

describe("node env declares host functions as functions", () => {
  it("host oracle: every host-provided member is typeof function", () => {
    const types = hostMemberTypes();
    expect(types).toHaveLength(MEMBERS.length);
    MEMBERS.forEach(([label], i) => {
      const t = types[i]!;
      if (t === null) {
        // 宿主没有该根全局 ⇒ 成员不存在（不是「折成了 object」）⇒ 只能超前声明
        expect(label.startsWith("Temporal."), `宿主缺 ${label} 的根全局`).toBe(true);
        return;
      }
      expect(t, `${label} typeof`).toBe("function");
    });
    // 非空的成员必须是**真函数**（不是数据值）：宿主有 ⇒ typeof 就是 "function"
    const provided = types.filter((t) => t !== null);
    expect(provided.length).toBeGreaterThan(0);
    expect(provided.every((t) => t === "function")).toBe(true);
  });

  it("typeof folds to \"function\" in the node env (was自信的 \"object\")", () => {
    const src = MEMBERS.map(
      ([label], i) => `export function t${i}(){ return typeof ${label}; }`,
    ).join("\n");
    const out = checkNode(src);
    MEMBERS.forEach(([label], i) => {
      const sig = out.signatures.find((s) => s.name === `t${i}`);
      expect(sig?.display, `${label} typeof`).toBe('"function"');
    });
  });

  it("AbortSignal.any stays a callable static factory returning AbortSignal", () => {
    const any = staticSlotOf("AbortSignal", "any");
    expect(any?.shape.k).toBe("fn");
    expect(
      (any!.shape as { returnType?: { shape: { k: string; name?: string } } }).returnType?.shape.name,
    ).toBe("AbortSignal");
    const out = checkNode(`export function f(){ return AbortSignal.any([]); }`);
    expect(out.throwBrands).toEqual([]);
  });
});
});

// ---------------------------------------------------------------------------
// process.hrtime 是可调用的（不再 unknown + 误导诊断）
// ---------------------------------------------------------------------------
describe("process.hrtime 是可调用的（不再 unknown + 误导诊断）", () => {
/**
 * node env 的 `process.hrtime` 被建模成**不可调用的对象** ⇒
 * `process.hrtime()` 退化成 `unknown` + **误导诊断** `nudo:unknown-inference`
 * （把责任指向用户代码）。
 *
 * 修法：`process.hrtime` 建成**可调用**的 envFn（返回 [seconds, nanos] 数组），
 * `bigint` 作为挂在它身上的静态槽（`opts.slots`）——原生
 * `process.hrtime.bigint()` 返回 bigint。
 *
 * 证据口径：原生 oracle（同进程真实 process.hrtime）+ 引擎探针。
 */





const env = defineEnv();

function shapeOf(a: Abs | undefined, label: string): string {
  expect(a, `expected Abs at ${label}`).toBeTruthy();
  return formatShape(a!);
}

function walk(a: Abs | undefined, ...keys: string[]): Abs | undefined {
  let cur: Abs | undefined = a;
  for (const k of keys) {
    if (!cur) return undefined;
    if (cur.shape.k === "brand") cur = cur.shape.shape as Abs | undefined;
    if (!cur || cur.shape.k !== "obj") return undefined;
    cur = cur.shape.slots[k]?.value;
  }
  return cur;
}

/** fn 形全局的**静态槽**面（envFn 的 `opts.slots`） */
function staticSlot(a: Abs | undefined, name: string): Abs | undefined {
  if (!a || a.shape.k !== "fn") return undefined;
  const slots = (a.shape as { slots?: Record<string, { value: Abs }> }).slots;
  return slots?.[name]?.value;
}

function check(src: string) {
  return checkSource("/t/env-bug-875.js", src, pTrue, {
    inject: { envGlobals: env.globals },
  });
}

describe("process.hrtime 是可调用的（不再 unknown + 误导诊断）", () => {
  it("原生 oracle：process.hrtime 是函数，返回 [seconds, nanos]；bigint() 返回 bigint", () => {
    expect(typeof process.hrtime).toBe("function");
    const t = process.hrtime();
    expect(Array.isArray(t)).toBe(true);
    expect(t.length).toBe(2);
    expect(typeof t[0]).toBe("number");
    expect(typeof t[1]).toBe("number");
    expect(typeof process.hrtime.bigint()).toBe("bigint");
  });

  it("env：hrtime 是 envFn（可调用）+ 静态槽 bigint", () => {
    const hrtime = walk(env.globals.process, "hrtime");
    expect(hrtime, "process.hrtime 缺失").toBeTruthy();
    expect(hrtime!.shape.k, "hrtime 形状").toBe("fn");
    expect(shapeOf(hrtime, "hrtime")).toContain("=>");
    expect(shapeOf(staticSlot(hrtime, "bigint"), "hrtime.bigint")).toContain("bigint");
  });

  it("引擎探针：process.hrtime() 推出 number[]，且无 unknown-inference 误导诊断", () => {
    const src = `
      export function useHrtime() { const t = process.hrtime(); return t; }
      export function useHrtimeBigint() { return process.hrtime.bigint(); }
    `;
    const r = check(src);
    expect(r.issues.filter((i) => i.code === "nudo:unknown-inference")).toEqual([]);
    expect(r.issues.filter((i) => i.code === "nudo:entry-may-throw")).toEqual([]);
    const byName = new Map(r.signatures.map((s) => [s.name, s.display]));
    expect(byName.get("useHrtime")).toMatch(/^number\[\]/);
    expect(byName.get("useHrtimeBigint")).toMatch(/^bigint\b/);
  });
});
});

// ---------------------------------------------------------------------------
// process 再补 7 个真实成员（不再定抛 TypeError）
// ---------------------------------------------------------------------------
describe("process 再补 7 个真实成员（不再定抛 TypeError）", () => {
/**
 * env node 的 `process` 成员表**再缺 7 个真实成员**
 * （`umask` / `getActiveResourcesInfo` / `resourceUsage` / `availableMemory` /
 * `loadEnvFile` / `getBuiltinModule` / `constrainedMemory`）⇒ 正确代码拿到 7 处
 * `nudo:entry-may-throw` 假红。
 *
 * 修法：packages/env/src/node.ts 的 `process` 表补这 7 个成员。
 * `loadEnvFile` 只声明「不抛」的常规路径（原生对**不存在**的文件抛 ENOENT——
 * 那是错误路径的精度债，见交付报告；声明 may-throw 会把 L2 门禁假红引回来）。
 *
 * 证据口径：原生 oracle（同进程真实 process）+ 引擎探针。
 */





const env = defineEnv();

function shapeOf(a: Abs | undefined, label: string): string {
  expect(a, `expected Abs at ${label}`).toBeTruthy();
  return formatShape(a!);
}

function walk(a: Abs | undefined, ...keys: string[]): Abs | undefined {
  let cur: Abs | undefined = a;
  for (const k of keys) {
    if (!cur) return undefined;
    if (cur.shape.k === "brand") cur = cur.shape.shape as Abs | undefined;
    if (!cur || cur.shape.k !== "obj") return undefined;
    cur = cur.shape.slots[k]?.value;
  }
  return cur;
}

function check(src: string) {
  return checkSource("/t/env-bug-892.js", src, pTrue, {
    inject: { envGlobals: env.globals },
  });
}

describe("process 再补 7 个真实成员（不再定抛 TypeError）", () => {
  it("原生 oracle：七个成员在真实 Node 上都存在", () => {
    expect(typeof process.umask).toBe("function");
    expect(typeof process.getActiveResourcesInfo).toBe("function");
    expect(typeof process.resourceUsage).toBe("function");
    expect(typeof process.availableMemory).toBe("function");
    expect(typeof process.loadEnvFile).toBe("function");
    expect(typeof process.getBuiltinModule).toBe("function");
    expect(typeof process.constrainedMemory).toBe("function");
  });

  it("env：process 面带这 7 个成员", () => {
    for (const name of [
      "umask",
      "getActiveResourcesInfo",
      "resourceUsage",
      "availableMemory",
      "loadEnvFile",
      "getBuiltinModule",
      "constrainedMemory",
    ]) {
      expect(shapeOf(walk(env.globals.process, name), `process.${name}`)).toContain("=>");
    }
  });

  it("引擎探针：7 处 nudo:entry-may-throw 假红消失", () => {
    const src = `
      export function a() { return process.umask(0o022); }
      export function b() { return process.getActiveResourcesInfo(); }
      export function c() { return process.resourceUsage(); }
      export function d() { return process.availableMemory(); }
      export function e(p) { return process.loadEnvFile(p); }
      export function f(id) { return process.getBuiltinModule(id); }
      export function g() { return process.constrainedMemory(); }
    `;
    const r = check(src);
    expect(r.issues.filter((i) => i.code === "nudo:entry-may-throw")).toEqual([]);
    expect(r.issues.filter((i) => i.code === "nudo:unknown-inference")).toEqual([]);
    const byName = new Map(r.signatures.map((s) => [s.name, s.display]));
    expect(byName.get("a")).toMatch(/^number\b/);
    expect(byName.get("b")).toMatch(/^string\[\]/);
    expect(byName.get("d")).toMatch(/^number\b/);
    expect(byName.get("g")).toMatch(/^number\b/);
  });
});
});

// ---------------------------------------------------------------------------
// process 补 5 个真实成员（不再定抛 TypeError）
// ---------------------------------------------------------------------------
describe("process 补 5 个真实成员（不再定抛 TypeError）", () => {
/**
 * node env 的 `process` 成员表**缺 5 个真实成员**
 * （`emitWarning` / `abort` / `kill` / `release` / `features`）⇒ 正确代码拿到
 * 5 处 `nudo:entry-may-throw` 假红（成员读出 exact undefined ⇒ 调用 undefined
 * ⇒ 引擎**证明**「必抛 TypeError」）。
 *
 * 修法：packages/env/src/node.ts 的 `process` 表补这 5 个成员。
 * `features` 用**开放键 + boolean|string|undefined 值域**（键随构建而变；
 * 值域不用 unknown——否则 `process.features.icu` 退化成 unknown 并误报
 * nudo:unknown-inference）。
 *
 * 证据口径：原生 oracle（同进程真实 process）+ 引擎探针。
 */





const env = defineEnv();

function shapeOf(a: Abs | undefined, label: string): string {
  expect(a, `expected Abs at ${label}`).toBeTruthy();
  return formatShape(a!);
}

function walk(a: Abs | undefined, ...keys: string[]): Abs | undefined {
  let cur: Abs | undefined = a;
  for (const k of keys) {
    if (!cur) return undefined;
    if (cur.shape.k === "brand") cur = cur.shape.shape as Abs | undefined;
    if (!cur || cur.shape.k !== "obj") return undefined;
    cur = cur.shape.slots[k]?.value;
  }
  return cur;
}

function check(src: string) {
  return checkSource("/t/env-bug-876.js", src, pTrue, {
    inject: { envGlobals: env.globals },
  });
}

describe("process 补 5 个真实成员（不再定抛 TypeError）", () => {
  it("原生 oracle：五个成员在真实 Node 上都存在", () => {
    expect(typeof process.emitWarning).toBe("function");
    expect(typeof process.abort).toBe("function");
    expect(typeof process.kill).toBe("function");
    expect(typeof process.release).toBe("object");
    expect(typeof process.features).toBe("object");
    expect(typeof process.release.name).toBe("string");
  });

  it("env：process 面带 emitWarning / abort / kill / release / features", () => {
    for (const name of ["emitWarning", "abort", "kill"]) {
      expect(shapeOf(walk(env.globals.process, name), `process.${name}`)).toContain("=>");
    }
    expect(shapeOf(walk(env.globals.process, "release", "name"), "release.name")).toContain(
      "string",
    );
    expect(shapeOf(walk(env.globals.process, "features"), "process.features")).toBeTruthy();
  });

  it("引擎探针：五处 nudo:entry-may-throw 假红消失", () => {
    const src = `
      export function g1() { return process.emitWarning("x"); }
      export function g2() { return process.features.icu; }
      export function g3() { return process.release.name; }
      export function g4() { return process.kill(1, "SIGTERM"); }
    `;
    const r = check(src);
    expect(r.issues.filter((i) => i.code === "nudo:entry-may-throw")).toEqual([]);
    expect(r.issues.filter((i) => i.code === "nudo:unknown-inference")).toEqual([]);
    const byName = new Map(r.signatures.map((s) => [s.name, s.display]));
    expect(byName.get("g3")).toMatch(/^string\b/);
    expect(byName.get("g4")).toMatch(/^boolean\b/);
  });
});
});

// ---------------------------------------------------------------------------
// process.stdin 成员表补全（不再定抛 TypeError）
// ---------------------------------------------------------------------------
describe("process.stdin 成员表补全（不再定抛 TypeError）", () => {
/**
 * env node：`process.stdin` 只建模 `{on}` ⇒ `process.stdin.setEncoding("utf8")`
 * 被判**定抛 TypeError**（假红；原生不抛）。
 *
 * 修法：process 的三个流（stdin / stdout / stderr）共用一张 Socket 面
 * （packages/env/src/node.ts 的 `processStreamBase`）——on/once/off/emit/
 * addListener/removeListener/pipe/destroy/setEncoding/pause/resume/read/
 * isTTY/fd/readable/writable；stdin 另加只读面，stdout/stderr 另加可写面。
 *
 * 证据口径：原生 oracle（同进程真实 process.stdin）+ 引擎探针。
 */





const env = defineEnv();

function shapeOf(a: Abs | undefined, label: string): string {
  expect(a, `expected Abs at ${label}`).toBeTruthy();
  return formatShape(a!);
}

function walk(a: Abs | undefined, ...keys: string[]): Abs | undefined {
  let cur: Abs | undefined = a;
  for (const k of keys) {
    if (!cur) return undefined;
    if (cur.shape.k === "brand") cur = cur.shape.shape as Abs | undefined;
    if (!cur || cur.shape.k !== "obj") return undefined;
    cur = cur.shape.slots[k]?.value;
  }
  return cur;
}

function check(src: string) {
  return checkSource("/t/env-bug-869.js", src, pTrue, {
    inject: { envGlobals: env.globals },
  });
}

describe("process.stdin 成员表补全（不再定抛 TypeError）", () => {
  it("原生 oracle：process.stdin 真的有 setEncoding / pause / resume / read", () => {
    expect(typeof process.stdin.setEncoding).toBe("function");
    expect(typeof process.stdin.pause).toBe("function");
    expect(typeof process.stdin.resume).toBe("function");
    expect(typeof process.stdin.read).toBe("function");
    expect(typeof process.stdin.on).toBe("function");
  });

  it("env：process.stdin 面带 setEncoding / pause / resume / read 等成员", () => {
    const stdin = walk(env.globals.process, "stdin");
    expect(stdin, "process.stdin 缺失").toBeTruthy();
    for (const name of ["on", "once", "off", "emit", "setEncoding", "pause", "resume", "read"]) {
      expect(shapeOf(walk(stdin, name), `stdin.${name}`)).toContain("=>");
    }
    expect(shapeOf(walk(stdin, "isTTY"), "stdin.isTTY")).toBeTruthy();
    expect(shapeOf(walk(stdin, "fd"), "stdin.fd")).toContain("number");
  });

  it("引擎探针：process.stdin.setEncoding(\"utf8\") 不再定抛 TypeError", () => {
    const src = `
      export function s1() { return process.stdin.setEncoding("utf8"); }
      export function s2() { return process.stdin.on("data", (c) => { void c; }); }
    `;
    const r = check(src);
    expect(r.issues.filter((i) => i.code === "nudo:entry-may-throw")).toEqual([]);
    for (const s of r.signatures) {
      expect(s.throws, `${s.name} 不应有 throws 面`).toBeUndefined();
    }
  });
});
});

// ---------------------------------------------------------------------------
// process.stdout / stderr 成员表补全（不再定抛 TypeError）
// ---------------------------------------------------------------------------
describe("process.stdout / stderr 成员表补全（不再定抛 TypeError）", () => {
/**
 * node env 的 `process.stdout` / `process.stderr` 面**只有 `write`**
 * ⇒ `.on(...)` 必抛 TypeError ⇒ L2 门禁假红。
 *
 * 修法：stdout / stderr 与 stdin 共用 Socket 面（packages/env/src/node.ts 的
 * `processStreamBase`），另加可写面（write / end / cork / uncork）。
 *
 * 证据口径：原生 oracle（同进程真实 process.stdout/stderr）+ 引擎探针。
 */





const env = defineEnv();

function shapeOf(a: Abs | undefined, label: string): string {
  expect(a, `expected Abs at ${label}`).toBeTruthy();
  return formatShape(a!);
}

function walk(a: Abs | undefined, ...keys: string[]): Abs | undefined {
  let cur: Abs | undefined = a;
  for (const k of keys) {
    if (!cur) return undefined;
    if (cur.shape.k === "brand") cur = cur.shape.shape as Abs | undefined;
    if (!cur || cur.shape.k !== "obj") return undefined;
    cur = cur.shape.slots[k]?.value;
  }
  return cur;
}

function check(src: string) {
  return checkSource("/t/env-bug-871.js", src, pTrue, {
    inject: { envGlobals: env.globals },
  });
}

describe("process.stdout / stderr 成员表补全（不再定抛 TypeError）", () => {
  it("原生 oracle：stdout / stderr 真的有 on / once / off / emit / write", () => {
    for (const s of [process.stdout, process.stderr]) {
      expect(typeof s.on).toBe("function");
      expect(typeof s.once).toBe("function");
      expect(typeof s.off).toBe("function");
      expect(typeof s.emit).toBe("function");
      expect(typeof s.write).toBe("function");
    }
  });

  it("env：stdout / stderr 面带 on / once / off / emit / write / end 等成员", () => {
    for (const name of ["stdout", "stderr"]) {
      const stream = walk(env.globals.process, name);
      expect(stream, `process.${name} 缺失`).toBeTruthy();
      for (const m of ["on", "once", "off", "emit", "write", "end", "destroy", "cork", "uncork"]) {
        expect(shapeOf(walk(stream, m), `${name}.${m}`)).toContain("=>");
      }
    }
  });

  it("引擎探针：process.stdout.on(...) 不再定抛 TypeError", () => {
    const src = `
      export function o1() { return process.stdout.on("data", (c) => { void c; }); }
      export function o2() { return process.stderr.on("error", (c) => { void c; }); }
      export function o3() { return process.stdout.write("x"); }
    `;
    const r = check(src);
    expect(r.issues.filter((i) => i.code === "nudo:entry-may-throw")).toEqual([]);
    for (const s of r.signatures) {
      expect(s.throws, `${s.name} 不应有 throws 面`).toBeUndefined();
    }
  });
});
});

// ---------------------------------------------------------------------------
// process.title is modelled
// ---------------------------------------------------------------------------
describe("process.title is modelled", () => {
/**
 * 族 15 · 全局 `process` 是**封闭对象**且槽表漏 `title`
 * ⇒ 读 `process.title` 得到 exact `undefined` ⇒
 * - `process.title.length` 判「确定抛 TypeError」（L2 假红，exit 1）；
 * - `typeof process.title` 折成 **`"undefined"`**（宿主 `"string"`）
 * ⇒ 特性探测分支被**反向**折叠（控制流也错）。
 *
 * 反向钉：删掉 `title` 槽 ⇒ 本文件必挂。
 */
describe("process.title is modelled", () => {
  it("host oracle: process.title is a string", () => {
    expect(typeof process.title).toBe("string");
    expect(process.title.length).toBeGreaterThan(0);
  });

  it("process.title is declared as string", () => {
    expect(nodeSlotOf("process", "title")).toBeTruthy();
  });

  it("process.title.length folds to number (was definite TypeError)", () => {
    const out = checkNode(`export function f(){ return process.title.length; }`);
    expect(out.signatures[0]!.display).toBe("number");
    expect(out.throwBrands).toEqual([]);
    expect(out.errorCodes).toEqual([]);
  });

  it("typeof process.title folds to \"string\" (was \"undefined\")", () => {
    const out = checkNode(`export function f(){ return typeof process.title; }`);
    expect(out.signatures[0]!.display).toBe('"string"');
  });

  it("control: the same expression shape on process.version stays correct", () => {
    const out = checkNode(`export function a(){ return process.version.length; }
export function b(){ return typeof process.version; }`);
    expect(out.signatures.find((s) => s.name === "a")!.display).toBe("number");
    expect(out.signatures.find((s) => s.name === "b")!.display).toBe('"string"');
    expect(out.throwBrands).toEqual([]);
  });
});
});

// ---------------------------------------------------------------------------
// fs/promises 结果对象与同步族共用成员表
// ---------------------------------------------------------------------------
describe("fs/promises 结果对象与同步族共用成员表", () => {
/**
 * 族 29 · `fs/promises` 的结果对象是同步族的**裁剪副本**
 * ——`fsPromisesModule.stat` 只抄了 12 个槽（比同步族少 9 个），且
 * `readdir` 的 `Dirent` 是**空 shape 的 brand** ⇒ 成员读出
 * **exact `undefined` / `NaN` / `never`**——那是**确定的错值**，不是精度债。
 *
 * 修法：`statsAbs` / `direntAbs` 抽成**共享常量**，同步族与 promise 族
 * 共用同一张成员表（原生 oracle：两族的成员表**完全一致**）。
 *
 * 原生 oracle（Node v26）：`fs.statSync(p)` 与 `fs.promises.stat(p)` 的
 * 成员表一致（数据属性 + 原型上的谓词方法 + Date 时刻）。
 */






/** promise 兑现值的内层（`promiseOf(x)` ⇒ x）。 */
function promiseInner(a: unknown): Abs | undefined {
  if (!a) return undefined;
  const s = (a as Abs).shape as { k?: string; inner?: Abs };
  return s.k === "eff" ? s.inner : undefined;
}

/** 数组的元素类型。 */
function elementOf(a: Abs | undefined): Abs | undefined {
  if (!a) return undefined;
  const s = a.shape as { k?: string; element?: Abs };
  return s.k === "arr" ? s.element : undefined;
}

/** sum 里的某个成员（按品牌名找）。 */
function sumMember(a: Abs | undefined, brandNameWanted: string): Abs | undefined {
  if (!a) return undefined;
  const s = a.shape as { k?: string; members?: Abs[] };
  if (s.k !== "sum") return undefined;
  return s.members?.find((m) => m.shape.k === "brand" && (m.shape as { name: string }).name === brandNameWanted);
}

describe("fs/promises 结果对象与同步族共用成员表", () => {
  it("1. 原生 oracle：同步族与 promise 族的 Stats 成员表一致", async () => {
    const sync = fs.statSync("/tmp");
    const promised = await fsp.stat("/tmp");
    expect(Object.keys(promised).sort()).toEqual(Object.keys(sync).sort());
    // 谓词方法在原型上
    for (const m of ["isFile", "isDirectory", "isSymbolicLink", "isBlockDevice", "isCharacterDevice", "isFIFO", "isSocket"]) {
      expect(typeof (sync as unknown as Record<string, unknown>)[m], m).toBe("function");
      expect(typeof (promised as unknown as Record<string, unknown>)[m], m).toBe("function");
    }
  });

  it("2. 声明面：promise 族的 stat 兑现值含完整成员表（不再是裁剪副本）", () => {
    const ret = envMember("node:fs/promises", "stat").shape as { returnType?: Abs };
    const inner = promiseInner(ret.returnType);
    expect(inner, "stat 的返回类型应是 promise").toBeDefined();
    const slots = slotsOf(inner!);
    for (const k of [
      "isFile", "isDirectory", "isSymbolicLink", "isBlockDevice", "isCharacterDevice",
      "isFIFO", "isSocket", "size", "mode", "uid", "gid", "ino", "dev", "nlink",
      "blksize", "blocks", "rdev", "mtime", "ctime", "atime", "birthtime",
      "mtimeMs", "ctimeMs", "atimeMs", "birthtimeMs",
    ]) {
      expect(slots[k], `stat 兑现值缺 ${k}`).toBeDefined();
    }
    expect(formatShape(slots["mtimeMs"]!.value)).toBe("number");
    expect(formatShape(slots["mtime"]!.value)).toBe("Date");
    expect(formatShape(slots["isFile"]!.value)).toContain("bool");
  });

  it("3. 同步族与 promise 族**共用同一张表**（成员集合相等）", () => {
    const syncRet = envMember("node:fs", "statSync").shape as { returnType?: Abs };
    const promisedRet = envMember("node:fs/promises", "stat").shape as { returnType?: Abs };
    const syncSlots = Object.keys(slotsOf(syncRet.returnType!)).sort();
    const promisedSlots = Object.keys(slotsOf(promiseInner(promisedRet.returnType)!)).sort();
    expect(promisedSlots).toEqual(syncSlots);
  });

  it("4. Dirent：promise 族的 readdir 元素是**有 shape** 的 Dirent（旧面是空 brand）", () => {
    const ret = envMember("node:fs/promises", "readdir").shape as { returnType?: Abs };
    const inner = promiseInner(ret.returnType);
    expect(inner).toBeDefined();
    const element = elementOf(innerOf(inner!));
    expect(element, "readdir 兑现值应是数组").toBeDefined();
    const direntBrand = sumMember(element!, "Dirent");
    expect(direntBrand, "元素并集里应有 Dirent 品牌").toBeDefined();
    const dslots = slotsOf(innerOf(direntBrand!)!);
    expect(Object.keys(dslots).sort()).toEqual(["isDirectory", "isFile", "isSymbolicLink", "name", "parentPath"]);
    expect(formatShape(dslots["name"]!.value)).toBe("string");
  });

  it("5. 反向钉：promise 族的成员读出**不得**是 exact undefined（旧面裁剪副本）", () => {
    const site = callSite(envMember("node:fs/promises", "stat"), [strLit("/tmp")]);
    expect(site.value).toBeDefined();
    const slots = slotsOf(promiseInner(site.value)!);
    // 旧面：这些槽缺 ⇒ 读出 exact undefined（引擎显示 `promise<NaN>` / `promise<undefined>`）
    expect(slots["mtimeMs"], "mtimeMs 缺槽 ⇒ 读出 exact undefined").toBeDefined();
    expect(slots["nlink"], "nlink 缺槽 ⇒ 读出 exact undefined").toBeDefined();
    expect(slots["isBlockDevice"], "isBlockDevice 缺槽 ⇒ 读出 exact undefined").toBeDefined();
  });

  it("6. readdir 的 withFileTypes 分叉：true ⇒ Dirent[]（原生如此）", async () => {
    const native = await fsp.readdir("/tmp", { withFileTypes: true });
    expect(native[0]?.isFile).toBeTypeOf("function");
    const site = callSite(envMember("node:fs/promises", "readdir"), [
      strLit("/tmp"),
      objOf({ withFileTypes: { value: boolLit(true) } }),
    ]);
    const element = elementOf(promiseInner(site.value!));
    expect(element, "withFileTypes:true ⇒ 元素应是 Dirent").toBeDefined();
    expect(element!.shape.k).toBe("brand");
    expect(slotsOf(innerOf(element!)!)["name"], "Dirent.name 槽").toBeDefined();
  });
});
});

// ---------------------------------------------------------------------------
// node:fs 同步族的 throws 面
// ---------------------------------------------------------------------------
describe("node:fs 同步族的 throws 面", () => {
/**
 * 族 29 · `node:fs` **同步族**被建模成「**永不抛**」⇒
 * `readFileSync("/nope/x")` 这类原生**必抛**（`Error` + `code=ENOENT`）的
 * 调用，引擎判「不抛」——**L2 假绿**。
 *
 * 修法：同步族加 **throws 面**（`errBrand("Error")`）。语义是
 * **may-throw**（引擎判不出路径是否存在 ⇒ 不是 always-throw；
 * 成功路径不该变成「必抛」）。
 *
 * 原生 oracle（Node v26）：`fs.readFileSync("/nope/x")` → `Error`
 * （`e.name === "Error"`、`e.code === "ENOENT"`）；`fs.existsSync("/nope/x")`
 * → `false`（**不抛**）。
 */





/** 同步族里「原生可能抛」的成员（的修法清单）。 */
const MAY_THROW = [
  "readFileSync",
  "writeFileSync",
  "appendFileSync",
  "mkdirSync",
  "rmdirSync",
  "unlinkSync",
  "renameSync",
  "copyFileSync",
  "statSync",
  "readdirSync",
  "realpathSync",
  "readlinkSync",
  "symlinkSync",
  "chmodSync",
  "chownSync",
  "accessSync",
];

/** 原生 oracle：不存在的路径 ⇒ 抛 `Error`（带 code）。 */
const NATIVE_THROWS: Array<[string, () => unknown]> = [
  ["readFileSync", () => fs.readFileSync("/nope/nope.txt")],
  ["writeFileSync", () => fs.writeFileSync("/nope/nope.txt", "x")],
  ["appendFileSync", () => fs.appendFileSync("/nope/nope.txt", "x")],
  ["mkdirSync", () => fs.mkdirSync("/nope/nope-dir")],
  ["rmdirSync", () => fs.rmdirSync("/nope/nope-dir")],
  ["unlinkSync", () => fs.unlinkSync("/nope/nope.txt")],
  ["renameSync", () => fs.renameSync("/nope/a", "/nope/b")],
  ["copyFileSync", () => fs.copyFileSync("/nope/a", "/nope/b")],
  ["statSync", () => fs.statSync("/nope/nope.txt")],
  ["readdirSync", () => fs.readdirSync("/nope/nope-dir")],
  ["realpathSync", () => fs.realpathSync("/nope/nope.txt")],
  ["readlinkSync", () => fs.readlinkSync("/nope/nope.txt")],
  ["symlinkSync", () => fs.symlinkSync("/nope/a", "/nope/b")],
  ["chmodSync", () => fs.chmodSync("/nope/nope.txt", 0o644)],
  ["chownSync", () => fs.chownSync("/nope/nope.txt", 0, 0)],
  ["accessSync", () => fs.accessSync("/nope/nope.txt")],
];

describe("node:fs 同步族的 throws 面", () => {
  it("1. 原生 oracle：同步族对不存在的路径抛 Error（带 code=ENOENT）", () => {
    for (const [name, fn] of NATIVE_THROWS) {
      let caught: unknown;
      try {
        fn();
      } catch (e) {
        caught = e;
      }
      expect(caught, `${name} 原生应抛`).toBeTruthy();
      const e = caught as { name?: string; code?: string };
      expect(e.name, `${name} 原生异常名`).toBe("Error");
      expect(e.code, `${name} 原生异常 code`).toBe("ENOENT");
    }
  });

  it("2. 引擎侧：同步族调用点记一条 may-throw（Error）throw exit", () => {
    for (const name of MAY_THROW) {
      const fn = envMember("node:fs", name);
      const site = callSite(fn, [strLit("/nope/nope.txt")]);
      expect(site.threw, `${name} 是 may-throw，不该冒泡`).toBeUndefined();
      expect(site.exits.length, `${name} 应记一条 throw exit`).toBe(1);
      expect(brandName(site.exits[0]), `${name} 的 throws 品牌`).toBe("Error");
    }
  });

  it("3. 反向钉：existsSync 原生永不抛 ⇒ 引擎也不得记 throws", () => {
    expect(fs.existsSync("/nope/nope.txt")).toBe(false);
    const site = callSite(envMember("node:fs", "existsSync"), [strLit("/nope/nope.txt")]);
    expect(site.threw).toBeUndefined();
    expect(site.exits, "existsSync 不该有 throw exit").toHaveLength(0);
  });

  it("4. 反向钉：may-throw ≠ always-throw（成功路径的值面不得塌成 never）", () => {
    const site = callSite(envMember("node:fs", "readFileSync"), [strLit("/etc/hostname")]);
    expect(site.threw).toBeUndefined();
    expect(site.value, "成功路径仍应有值面").toBeDefined();
    expect(site.value!.shape.k).not.toBe("never");
  });

  it("5. rmSync：原生 force:true 吞掉 ENOENT（不抛）⇒ 引擎也不得记 throws", () => {
    expect(() => fs.rmSync("/nope/nope.txt", { force: true })).not.toThrow();
    const forceTrue = objOf({ force: { value: boolLit(true) } });
    const site = callSite(envMember("node:fs", "rmSync"), [strLit("/nope/nope.txt"), forceTrue]);
    expect(site.threw).toBeUndefined();
    expect(site.exits, "force:true ⇒ 不记 throw exit").toHaveLength(0);

    // 反向：无 force ⇒ 原生抛 ⇒ 引擎记 may-throw
    expect(() => fs.rmSync("/nope/nope.txt")).toThrow();
    const noForce = callSite(envMember("node:fs", "rmSync"), [strLit("/nope/nope.txt")]);
    expect(noForce.exits.length).toBe(1);
    expect(brandName(noForce.exits[0])).toBe("Error");
  });

  it("6. 抽象实参不改变 throws 面（路径判不出存在性 ⇒ 恒为 may-throw）", () => {
    const site = callSite(envMember("node:fs", "readFileSync"), [
      { shape: { k: "prim", type: "string" }, conf: "exact" } as Abs,
    ]);
    expect(site.threw).toBeUndefined();
    expect(site.exits.length).toBe(1);
    expect(brandName(site.exits[0])).toBe("Error");
  });
});
});

// ---------------------------------------------------------------------------
// statSync / fs.promises.stat 的返回域（含 undefined 分支）
// ---------------------------------------------------------------------------
describe("statSync / fs.promises.stat 的返回域（含 undefined 分支）", () => {
/**
 * 族 29 · `statSync` / `fs.promises.stat` 的**返回域声明过窄**
 * ——原生 `statSync(p, { throwIfNoEntry: false })` 在路径不存在时**返回
 * undefined**（不抛），紧接着的成员读**必抛 TypeError**；旧面把返回域声明成
 * 「永不返回 undefined」⇒ 引擎判「不抛」还给出**自信的** `boolean` / `number`
 * ——**L2 假绿**。
 *
 * 修法：`throwIfNoEntry: false` 时返回域含 `undefined`（同步族与 promise 族
 * 同口径）。
 *
 * 原生 oracle（Node v26）：
 * - `fs.statSync("/nope", { throwIfNoEntry: false })` ⇒ `undefined`；
 * - `fs.statSync("/nope", { throwIfNoEntry: false }).isFile()` ⇒ TypeError；
 * - `fs.statSync("/nope")` ⇒ 抛 `Error`（code=ENOENT）。
 */






/** promise 兑现值的内层（`promiseOf(x)` ⇒ x）。 */
function promiseInner(a: unknown): Abs | undefined {
  if (!a) return undefined;
  const s = (a as Abs).shape as { k?: string; inner?: Abs };
  return s.k === "eff" ? s.inner : undefined;
}

/** `{ throwIfNoEntry: false }` 选项对象。 */
const NO_ENTRY = objOf({ throwIfNoEntry: { value: boolLit(false) } });

describe("statSync / fs.promises.stat 的返回域（含 undefined 分支）", () => {
  it("1. 原生 oracle：throwIfNoEntry:false ⇒ 返回 undefined（不抛）", () => {
    expect(fs.statSync("/nope/nope.txt", { throwIfNoEntry: false })).toBeUndefined();
    expect(() => fs.statSync("/nope/nope.txt")).toThrow();
  });

  it("2. 原生 oracle：undefined 上的成员读 ⇒ TypeError（返回域必须含 undefined）", () => {
    const st = fs.statSync("/nope/nope.txt", { throwIfNoEntry: false });
    expect(() => (st as { isFile: () => boolean }).isFile()).toThrow(TypeError);
  });

  it("3. 引擎侧：throwIfNoEntry:false ⇒ 返回域含 undefined（旧面：永不 undefined）", () => {
    const site = callSite(envMember("node:fs", "statSync"), [strLit("/nope/nope.txt"), NO_ENTRY]);
    expect(site.value, "应给出值面").toBeDefined();
    expect(formatShape(site.value!), "返回域应含 undefined").toContain("undefined");
  });

  it("4. 反向钉：默认形态（无 throwIfNoEntry:false）⇒ 返回域不含 undefined", () => {
    const site = callSite(envMember("node:fs", "statSync"), [strLit("/tmp")]);
    expect(site.value).toBeDefined();
    expect(formatShape(site.value!), "默认形态不该含 undefined").not.toContain("undefined");
  });

  it("5. promise 族同口径：兑现值含 undefined", async () => {
    // 宿主版本差：Node 22 的 fs.promises.stat 对 throwIfNoEntry:false 仍 reject
    // ENOENT（Node 26 才兑现 undefined）。原生 oracle 两边都给确定断言；
    // 下方**引擎声明面**的断言不受宿主行为影响，仍严格钉住 undefined 分支。
    const native = await fsp
      .stat("/nope/nope.txt", { throwIfNoEntry: false })
      .then(
        (v) => ({ resolved: v as unknown }),
        (e: NodeJS.ErrnoException) => ({ rejected: e.code }),
      );
    if ("resolved" in native) expect(native.resolved).toBeUndefined();
    else expect(native.rejected).toBe("ENOENT");
    const site = callSite(envMember("node:fs/promises", "stat"), [strLit("/nope/nope.txt"), NO_ENTRY]);
    const inner = promiseInner(site.value);
    expect(inner, "兑现值应有内层").toBeDefined();
    expect(formatShape(inner!), "兑现值域应含 undefined").toContain("undefined");
  });

  it("6. 反向钉：promise 族默认形态 ⇒ 兑现值不含 undefined", () => {
    const site = callSite(envMember("node:fs/promises", "stat"), [strLit("/tmp")]);
    const inner = promiseInner(site.value);
    expect(formatShape(inner!), "默认形态不该含 undefined").not.toContain("undefined");
  });

  it("7. 声明面：返回域的 undefined 分支由调用点的 options 决定（不是恒有）", () => {
    // 声明的返回类型仍是 Stats（不含 undefined）——undefined 只在
    // throwIfNoEntry:false 的调用点出现（旧面的「永不 undefined」就在这里）
    const declared = envMember("node:fs", "statSync").shape as { returnType?: Abs };
    expect(formatShape(declared.returnType!), "声明面不该含 undefined").not.toContain("undefined");
  });
});
});

// ---------------------------------------------------------------------------
// node:path 族实参类型执法
// ---------------------------------------------------------------------------
describe("node:path 族实参类型执法", () => {
/**
 * 族 29 · `node:path` 族的**实参类型从不被执法** ⇒
 * `path.join(123)` / `path.isAbsolute(123)` / `path.basename("/x/y.txt", 5)`
 * 这类原生**必抛 TypeError** 的调用被判「不抛」，还给出原生产不出的
 * **自信精确字面量**（`basename("/x/y.txt", 5)` → `"y.txt"`——坏实参被静默
 * 丢弃后走「无后缀」分支）。
 *
 * 修法：path 族实参执法闸——
 * - 实参**确定**非字符串 ⇒ **必抛** TypeError（原生必抛）；
 * - 实参**抽象**（unknown / any / 非 exact）⇒ **may-throw** TypeError；
 * - `undefined` 字面量：必填位 ⇒ 必抛；可选位（`basename(p, undefined)`）⇒
 * 视作未传（原生不抛）。
 *
 * 原生 oracle（Node v26）：见每个 case 的 `native` 回调（测试内直接对拍）。
 */






/** `undefined` 字面量（引擎里是 unknown shape + lit(undefined)）。 */
const UNDEF: Abs = {
  shape: { k: "unknown" },
  term: { op: "lit", value: undefined },
  conf: "exact",
};

/** apply 原始返回值的 abs 面（裸 Abs 或 AbsApplyResult 的 abs）。 */
function absFace(fn: Abs, args: Abs[]): Abs {
  const out = applyOut(fn, args) as Abs | { abs: Abs };
  if (out && typeof out === "object" && "abs" in (out as Record<string, unknown>)) {
    return (out as { abs: Abs }).abs;
  }
  return out as Abs;
}

/** apply 原始返回值的 throws 面。 */
function throwsFace(fn: Abs, args: Abs[]): Abs | undefined {
  const out = applyOut(fn, args) as { throws?: Abs };
  return out?.throws;
}

type Case = {
  name: string;
  member: string;
  args: Abs[];
  native: () => unknown;
};

// 坏实参（number）**故意**传给原生 path 族当 oracle——运行期就是原生
// 必抛 TypeError 的那批调用；类型层用 cast 表达「故意传错型」。
const BAD: Case[] = [
  { name: "join(123)", member: "join", args: [numLit(123)], native: () => nodePath.join(123 as unknown as string) },
  { name: "join('a', 1)", member: "join", args: [strLit("a"), numLit(1)], native: () => nodePath.join("a", 1 as unknown as string) },
  { name: "basename('/x/y.txt', 5)", member: "basename", args: [strLit("/x/y.txt"), numLit(5)], native: () => nodePath.basename("/x/y.txt", 5 as unknown as string) },
  { name: "dirname(123)", member: "dirname", args: [numLit(123)], native: () => nodePath.dirname(123 as unknown as string) },
  { name: "extname(456)", member: "extname", args: [numLit(456)], native: () => nodePath.extname(456 as unknown as string) },
  { name: "isAbsolute(123)", member: "isAbsolute", args: [numLit(123)], native: () => nodePath.isAbsolute(123 as unknown as string) },
  { name: "relative('/a', 7)", member: "relative", args: [strLit("/a"), numLit(7)], native: () => nodePath.relative("/a", 7 as unknown as string) },
  { name: "normalize(789)", member: "normalize", args: [numLit(789)], native: () => nodePath.normalize(789 as unknown as string) },
  { name: "parse(123)", member: "parse", args: [numLit(123)], native: () => nodePath.parse(123 as unknown as string) },
  { name: "resolve(789)", member: "resolve", args: [numLit(789)], native: () => nodePath.resolve(789 as unknown as string) },
  { name: "format(123)", member: "format", args: [numLit(123)], native: () => nodePath.format(123 as unknown as FormatInputPathObject) },
];

const GOOD: Case[] = [
  { name: "join('a','b')", member: "join", args: [strLit("a"), strLit("b")], native: () => nodePath.join("a", "b") },
  { name: "basename('/x/y.txt')", member: "basename", args: [strLit("/x/y.txt")], native: () => nodePath.basename("/x/y.txt") },
  { name: "basename('/x/y.txt', undefined)", member: "basename", args: [strLit("/x/y.txt"), UNDEF], native: () => nodePath.basename("/x/y.txt", undefined) },
  { name: "dirname('/x/y.txt')", member: "dirname", args: [strLit("/x/y.txt")], native: () => nodePath.dirname("/x/y.txt") },
  { name: "extname('/x/y.txt')", member: "extname", args: [strLit("/x/y.txt")], native: () => nodePath.extname("/x/y.txt") },
  { name: "isAbsolute('/x')", member: "isAbsolute", args: [strLit("/x")], native: () => nodePath.isAbsolute("/x") },
  { name: "relative('/a','/b')", member: "relative", args: [strLit("/a"), strLit("/b")], native: () => nodePath.relative("/a", "/b") },
  { name: "normalize('/x/./y')", member: "normalize", args: [strLit("/x/./y")], native: () => nodePath.normalize("/x/./y") },
  { name: "parse('/x/y.txt')", member: "parse", args: [strLit("/x/y.txt")], native: () => nodePath.parse("/x/y.txt") },
];

describe("node:path 族实参类型执法", () => {
  it("1. 实参确定非字符串 ⇒ 必抛 TypeError（原生 oracle 同样必抛）", () => {
    for (const c of BAD) {
      // 原生 oracle：必抛 TypeError
      expect(() => c.native(), c.name).toThrow(TypeError);

      const site = callSite(envMember("node:path", c.member), c.args);
      // 必抛 ⇒ NudoThrow 冒泡（不是 may-throw）
      expect(site.threw, `${c.name} 应必抛`).toBeTruthy();
      expect(site.value, `${c.name} 不应有值面`).toBeUndefined();
    }
  });

  it("2. 必抛的 throws 面品牌是 TypeError、值面是 never", () => {
    for (const c of BAD) {
      const fn = envMember("node:path", c.member);
      expect(absFace(fn, c.args).shape.k, `${c.name} 的值面`).toBe("never");
      expect(brandName(throwsFace(fn, c.args)), `${c.name} 的 throws 品牌`).toBe("TypeError");
    }
  });

  it("3. 坏实参**不得**折出自信精确字面量（basename 旧面折 'y.txt'）", () => {
    const fn = envMember("node:path", "basename");
    const site = callSite(fn, [strLit("/x/y.txt"), numLit(5)]);
    // 旧面：值面 = "y.txt"（原生抛 TypeError，压根没有这个值）
    expect(site.value).toBeUndefined();
    expect(absFace(fn, [strLit("/x/y.txt"), numLit(5)]).shape.k).toBe("never");
  });

  it("4. 合法实参照旧折叠（不回归）", () => {
    for (const c of GOOD) {
      const native = c.native();
      const site = callSite(envMember("node:path", c.member), c.args);
      expect(site.threw, `${c.name} 不该抛`).toBeUndefined();
      expect(site.exits, `${c.name} 不该有 throw exit`).toHaveLength(0);
      if (typeof native === "string") {
        expect(formatShape(site.value!), `${c.name} 的值`).toBe(JSON.stringify(native));
      } else {
        // 对象类结果（parse）：只要有值面且不是 never
        expect(site.value, `${c.name} 应有值面`).toBeDefined();
        expect(site.value!.shape.k).not.toBe("never");
      }
    }
  });

  it("5. 抽象实参 ⇒ may-throw TypeError（不是必抛）", () => {
    const fn = envMember("node:path", "join");
    const out = absFace(fn, [{ shape: { k: "unknown" }, conf: "partial" } as Abs]);
    expect(out.shape.k, "抽象实参不应变成必抛").not.toBe("never");
    expect(brandName(throwsFace(fn, [{ shape: { k: "unknown" }, conf: "partial" } as Abs]))).toBe("TypeError");
  });

  it("6. posix / win32 平台路径对象同口径（原生 posix.join(123) 也必抛）", () => {
    expect(() => nodePath.posix.join(123 as unknown as string)).toThrow(TypeError);
    const posix = envMember("node:path", "posix");
    expect(posix.shape.k).toBe("brand");
    const inner = (posix.shape as { shape: Abs }).shape;
    const join = (inner.shape as { slots: Record<string, { value: Abs }> }).slots["join"]!.value;
    const site = callSite(join, [numLit(123)]);
    expect(site.threw, "path.posix.join(123) 应必抛").toBeTruthy();
  });
});
});

// ---------------------------------------------------------------------------
// path.posix / path.win32 carry parse and format
// ---------------------------------------------------------------------------
describe("path.posix / path.win32 carry parse and format", () => {
/**
 * 族 15 · `path.posix` / `path.win32` 用的是**另一份手抄成员表**，
 * 漏了 `parse` / `format` ⇒ 读这两个成员得到 **exact `undefined`**
 * （闭 obj 缺槽）⇒ 调用 ⇒ **确定抛 TypeError** ⇒ L2 门禁假红（exit 1），
 * 而宿主 `path.posix.parse("/a/b.txt")` 完全正常。
 *
 * 修法：平台对象**复用**顶层 `path` 的同一份实现（单一事实源）。
 *
 * 反向钉：把 `parse` / `format` 从 `platformPathMethods` 删掉 ⇒ 本文件必挂。
 */
function parsedOf(pathObj: unknown, input: string): string {
  return formatShape(
    applyOut(pathObj as never, [strLit(input)]) as never,
  );
}

describe("path.posix / path.win32 carry parse and format", () => {
  it("host oracle: posix.parse / win32.parse / posix.format all work", () => {
    expect(nodePath.posix.parse("/a/b.txt")).toEqual(nodePath.parse("/a/b.txt"));
    expect(nodePath.win32.parse("a\\b.txt")).toEqual({
      root: "",
      dir: "a",
      base: "b.txt",
      ext: ".txt",
      name: "b",
    });
    expect(nodePath.posix.format({ dir: "/a", base: "b.txt" })).toBe("/a/b.txt");
  });

  it("the platform member tables declare parse / format", () => {
    for (const platform of ["posix", "win32"] as const) {
      const face = envMember("node:path", platform);
      expect(slotOfAbs(face, "parse"), `path.${platform}.parse`).toBeTruthy();
      expect(slotOfAbs(face, "format"), `path.${platform}.format`).toBeTruthy();
      // 既有成员不受影响
      expect(slotOfAbs(face, "join")).toBeTruthy();
      expect(slotOfAbs(face, "sep")).toBeTruthy();
    }
  });

  it("posix.parse folds exactly like the top-level path.parse (single source of truth)", () => {
    const top = envMember("node:path", "parse");
    const posixParse = slotOfAbs(envMember("node:path", "posix"), "parse")!;
    const expected = parsedOf(top, "/a/b.txt");
    expect(parsedOf(posixParse, "/a/b.txt")).toBe(expected);
    expect(expected).toContain("/a");
  });

  it("win32.parse folds platform-specifically (not a definite TypeError)", () => {
    const win32Parse = slotOfAbs(envMember("node:path", "win32"), "parse")!;
    const out = parsedOf(win32Parse, "a\\b.txt");
    expect(out).toContain("b.txt");
    expect(out).not.toContain("never");
  });

  it("posix.format returns a string and rejects non-objects", () => {
    const format = slotOfAbs(envMember("node:path", "posix"), "format")!;
    // 往返：parse 的产物正是 format 的合法实参（obj 面）
    const roundTrip = applyOut(envMember("node:path", "parse"), [
      strLit("/a/b.txt"),
    ]) as Abs;
    expect(formatShape(callSite(format, [roundTrip]).value!)).toBe("string");
    // 原生 `path.format(123)` 定抛 TypeError ⇒ 没有返回值，且以抛出口结束
    const bad = callSite(format, [numLit(1)]);
    expect(bad.value).toBeUndefined();
    expect(bad.threw !== undefined || bad.exits.length > 0).toBe(true);
  });
});
});

// ---------------------------------------------------------------------------
// pathToFileURL 返回完整 URL 面
// ---------------------------------------------------------------------------
describe("pathToFileURL 返回完整 URL 面", () => {
/**
 * env node 的 `url.pathToFileURL` 返回域被声明成 **1 槽闭合对象 `{ href }`**
 * ⇒ `.pathname` / `.protocol` / `.host` … 读出 **exact `undefined`**（真值是
 * "/tmp/x.txt" 等），且 `.pathname.length` 被判**定抛 TypeError**（L2 假红）。
 *
 * 原生 oracle（Node v26.10.0 独立进程实测，pathToFileURL("/tmp/x.txt")）：
 * href = "file:///tmp/x.txt"
 * pathname = "/tmp/x.txt"
 * protocol = "file:"
 * host = "" hostname = "" port = ""
 * search = "" hash = "" origin = "null"
 * username = "" password = ""
 * toString() = "file:///tmp/x.txt" toJSON() = "file:///tmp/x.txt"
 *
 * 旧实现：`objAbs({ href: prim.str() })` ⇒ 闭对象**只有 href 一个槽** ⇒ 其余成员
 * 读出 exact `undefined`（**错值**），再链式读一次（`.pathname.length`）⇒ 引擎
 * 记「在 undefined 上取属性」⇒ **证明**「必抛 TypeError」⇒ L2 门禁假红。
 *
 * 新建模：返回域换成**完整 URL 面**（11 组件 + toString / toJSON），且 apply 对
 * 字面量路径给出**字面量精度**的实例面。
 *
 * 断言双向：正向钉住「成员表完整 + 值与原生一致」；
 * 反向（把返回域改回 `{ href }` 单槽）本文件必须失败。
 */






const env = defineEnv();
const url = env.modules!.url!;

/** obj 槽位（obj shape ⇒ slots） */
function slotsOf(a: Abs): Record<string, Abs> {
  const shape = a.shape as { k: string; slots?: Record<string, { value: Abs }> };
  expect(shape.k).toBe("obj");
  const out: Record<string, Abs> = {};
  for (const [k, slot] of Object.entries(shape.slots ?? {})) out[k] = slot.value;
  return out;
}

/** lit term 的字面量值（取不到 ⇒ undefined） */
function litOf(a: Abs | undefined): string | undefined {
  const t = a?.term as { op?: string; value?: unknown } | undefined;
  return t?.op === "lit" ? String(t.value) : undefined;
}

describe("pathToFileURL 返回完整 URL 面", () => {
  it("1. 字面量路径 ⇒ 实例面含全部 11 个 URL 组件 + toString / toJSON", () => {
    const site = callSite____env_bug_s4_helpers_ts(url.pathToFileURL!, [strLit("/tmp/x.txt")]);
    expect(site.threw).toBeUndefined();
    expect(site.exits).toHaveLength(0);
    const slots = slotsOf(site.value!);
    for (const key of [
      "href",
      "origin",
      "protocol",
      "username",
      "password",
      "host",
      "hostname",
      "port",
      "pathname",
      "search",
      "hash",
      "toString",
      "toJSON",
    ]) {
      expect(Object.keys(slots), `pathToFileURL result must expose ${key}`).toContain(key);
    }
  });

  it("2. 成员值与原生一致（href / pathname / protocol …）", () => {
    const native = nodePathToFileURL("/tmp/x.txt");
    const site = callSite____env_bug_s4_helpers_ts(url.pathToFileURL!, [strLit("/tmp/x.txt")]);
    const slots = slotsOf(site.value!);
    expect(litOf(slots.href)).toBe(native.href);
    expect(litOf(slots.pathname)).toBe(native.pathname);
    expect(litOf(slots.protocol)).toBe(native.protocol);
    expect(litOf(slots.host)).toBe(native.host);
    expect(litOf(slots.hostname)).toBe(native.hostname);
    expect(litOf(slots.port)).toBe(native.port);
    expect(litOf(slots.search)).toBe(native.search);
    expect(litOf(slots.hash)).toBe(native.hash);
    expect(litOf(slots.origin)).toBe(native.origin);
    expect(litOf(slots.username)).toBe(native.username);
    expect(litOf(slots.password)).toBe(native.password);
  });

  it("3. 声明面（抽象实参回落面）也是完整 URL 面（旧实现只有 href 一槽）", () => {
    const fmt = formatShape(url.pathToFileURL!);
    for (const key of ["href", "pathname", "protocol", "origin", "toString", "toJSON"]) {
      expect(fmt, `declared return face must carry ${key}`).toContain(key);
    }
  });

  it("4. 反向对照：旧单槽面读 pathname 会得到 exact undefined", () => {
    // 旧建模：objAbs({ href }) ⇒ 无 pathname 槽
    const site = callSite____env_bug_s4_helpers_ts(url.pathToFileURL!, [strLit("/tmp/x.txt")]);
    const slots = slotsOf(site.value!);
    expect(slots.pathname, "pathname must not be missing (old face had only href)").toBeTruthy();
    expect(litOf(slots.pathname)).not.toBeUndefined();
  });
});
});

// ---------------------------------------------------------------------------
// os.cpus() 的 times 成员表
// ---------------------------------------------------------------------------
describe("os.cpus() 的 times 成员表", () => {
/**
 * 族 29 · `os.cpus()` 的结果对象**缺 `times` 槽** ⇒
 * `cpus()[0].times.user` 读出 **exact `undefined`** ⇒ 引擎判「property
 * 'user' on undefined ⇒ 定抛 TypeError」——**假红**（原生正常返回数字）。
 *
 * 原生 oracle（Node v26）：`os.cpus()[0]` 的自有键 = model / speed / times，
 * `times` 的键 = user / nice / sys / idle / irq。
 * 旧面只建模 model / speed ⇒ times 缺槽 ⇒ 读出 exact undefined（不是精度债，
 * 是**确定的错值**）。
 */





describe("os.cpus() 的 times 成员表", () => {
  it("1. cpus() 元素含 times 槽（user/nice/sys/idle/irq 全在）", () => {
    const ret = envMember("node:os", "cpus");
    expect(ret.shape.k).toBe("fn");
    const fn = ret.shape as { returnType?: { shape: unknown } };
    const arr = fn.returnType!;
    expect(arr.shape).toMatchObject({ k: "arr" });
    const el = (arr.shape as { element: Parameters<typeof slotsOf>[0] }).element;
    const slots = slotsOf(el);
    expect(Object.keys(slots).sort()).toEqual(["model", "speed", "times"]);
    const times = slots["times"]!.value;
    const tslots = slotsOf(times);
    expect(Object.keys(tslots).sort()).toEqual(["idle", "irq", "nice", "sys", "user"]);
    for (const k of ["user", "nice", "sys", "idle", "irq"]) {
      expect(formatShape(tslots[k]!.value), `times.${k}`).toBe("number");
    }
  });

  it("2. 原生 oracle 对拍：声明的 times 成员名 = 原生 os.cpus()[0].times 的键", () => {
    const native = os.cpus()[0];
    expect(native, "本机应至少有一个 cpu").toBeDefined();
    const nativeTimes = Object.keys(native!.times).sort();
    const nativeCpu = Object.keys(native!).sort();
    const slots = slotsOf(
      (envMember("node:os", "cpus").shape as { returnType?: { shape: { element: Parameters<typeof slotsOf>[0] } } })
        .returnType!.shape.element,
    );
    expect(Object.keys(slots).sort()).toEqual(nativeCpu);
    expect(Object.keys(slotsOf(slots["times"]!.value)).sort()).toEqual(nativeTimes);
  });

  it("3. 反向钉：times 缺槽 ⇒ 成员读出 exact undefined（原生没有 undefined 成员）", () => {
    const el = (envMember("node:os", "cpus").shape as { returnType?: { shape: { element: Parameters<typeof slotsOf>[0] } } })
      .returnType!.shape.element;
    const slots = slotsOf(el);
    // 原生 times.user 是数字；声明面必须给出**成员槽**（而不是缺槽）
    expect(slots["times"]).toBeDefined();
    expect(slotsOf(slots["times"]!.value)["user"]).toBeDefined();
  });
});
});

// ---------------------------------------------------------------------------
// env node 模块导出构造器带 ctor:true
// ---------------------------------------------------------------------------
describe("env node 模块导出构造器带 ctor:true", () => {
/**
 * env node：`node:url` / `node:util` 的**模块导出构造器缺 `ctor: true`**
 * ⇒ 合法 `new URL(…)` / `new TextEncoder()` 被判**定抛 TypeError**（**假红**）。
 *
 * 原生 oracle（Node v26.10.0 独立进程实测）：
 * new URL("https://x.dev/a") → OK（href = "https://x.dev/a"）
 * new URLSearchParams("a=1") → OK
 * new TextEncoder() → OK
 * new TextDecoder("utf-8") → OK
 * —— **一个都不抛**。
 *
 * 旧实现：模块导出是 fn 形 callee 且**没有 `ctor` 标记** ⇒ core 的 `$new`
 * 落「fn 形 callee 构造性未知」分支 ⇒ 记
 * `recordMayThrow({kind:"TypeError", cause:"new on function value of unknown constructibility"})`
 * ⇒ 上层 L2 门禁对合法 Node 代码报 `nudo:entry-may-throw`（**假红**）。
 *
 * 修法：给这四个**模块导出**构造器补 `{ ctor: true }`。
 * **刻意不加 `name`**——带 name 会让 `$new` 按名派发到 core 的 `evalBuiltinNew`
 * （core 的 URL 模型），改道构造路径、丢掉 env 的字面量精度路径
 * （见 `packages/core/src/algebra/exec/class/declare.ts` 的 `ctorName` 分支）。
 *
 * 断言双向：正向钉住 ctor 标记 + `$new` 不再记 unknown-constructibility may-throw
 * + 实例面完整；反向（把 `ctor: true` 去掉）本文件必须失败。
 */





const env = defineEnv();
const url = env.modules!.url!;
const util = env.modules!.util!;

/** `$new` 取证：返回值 + 期间记下的 may-throw 效果 */
function newSite(
  ctor: Abs,
  args: Abs[],
): { value?: Abs; mayThrows: { kind: string; cause?: string }[] } {
  const mayThrows: { kind: string; cause?: string }[] = [];
  const value = runWithMayThrowSession(() => {
    setMayThrowCollector((e) => mayThrows.push({ kind: e.kind, cause: e.cause }));
    return $new(ctor, args);
  });
  return { value, mayThrows };
}

describe("env node 模块导出构造器带 ctor:true", () => {
  it("1. 四个模块导出构造器都带 ctor:true（URL / URLSearchParams / TextEncoder / TextDecoder）", () => {
    for (const ctor of [url.URL, url.URLSearchParams, util.TextEncoder, util.TextDecoder]) {
      expect(ctor, "module-exported constructor must exist").toBeTruthy();
      expect(ctor!.shape.k).toBe("fn");
      expect(
        (ctor!.shape as { ctor?: boolean }).ctor,
        "module-exported constructor must carry ctor:true",
      ).toBe(true);
    }
  });

  it("2. new URL(…) ⇒ 不记 unknown-constructibility may-throw + 实例面是 URL 面", () => {
    const site = newSite(url.URL!, [strLit("https://x.dev/a")]);
    expect(site.mayThrows, "new URL must not record a may-throw").toEqual([]);
    expect(site.value!.shape.k).toBe("obj");
    const slots = (site.value!.shape as { slots: Record<string, { value: Abs }> }).slots;
    // 原生 oracle：new URL("https://x.dev/a").href
    expect(new URL("https://x.dev/a").href).toBe("https://x.dev/a");
    expect(slots.href!.value).toBeDefined();
    expect(formatLit(slots.href!.value)).toBe("https://x.dev/a");
  });

  it("3. new URLSearchParams(…) ⇒ 不记 may-throw + 实例面带成员表", () => {
    const site = newSite(url.URLSearchParams!, [strLit("a=1")]);
    expect(site.mayThrows).toEqual([]);
    expect(site.value!.shape.k).toBe("obj");
    const slots = (site.value!.shape as { slots: Record<string, { value: Abs }> }).slots;
    expect(Object.keys(slots)).toContain("get");
    expect(Object.keys(slots)).toContain("toString");
  });

  it("4. new TextEncoder() / new TextDecoder(…) ⇒ 不记 may-throw + 实例面完整", () => {
    const enc = newSite(util.TextEncoder!, []);
    expect(enc.mayThrows).toEqual([]);
    expect(enc.value!.shape.k).toBe("obj");
    const encSlots = (enc.value!.shape as { slots: Record<string, { value: Abs }> }).slots;
    expect(Object.keys(encSlots)).toContain("encode");
    expect(Object.keys(encSlots)).toContain("encoding");

    const dec = newSite(util.TextDecoder!, [strLit("utf-8")]);
    expect(dec.mayThrows).toEqual([]);
    expect(dec.value!.shape.k).toBe("obj");
    const decSlots = (dec.value!.shape as { slots: Record<string, { value: Abs }> }).slots;
    expect(Object.keys(decSlots)).toContain("decode");
  });

  it("5. 反向对照：没有 ctor 标记的 fn 形 callee ⇒ 记 unknown-constructibility may-throw", () => {
    // util.inspect 是普通 fn（无 ctor 标记）⇒ $new 落「构造性未知」分支
    const site = newSite(util.inspect!, []);
    expect(site.mayThrows).toHaveLength(1);
    expect(site.mayThrows[0]!.kind).toBe("TypeError");
    expect(site.mayThrows[0]!.cause).toContain("unknown constructibility");
  });
});

/** lit term 的字面量值（取不到 ⇒ undefined） */
function formatLit(a: Abs): string | undefined {
  const t = a.term as { op?: string; value?: unknown } | undefined;
  return t?.op === "lit" ? String(t.value) : undefined;
}
});

// ---------------------------------------------------------------------------
// console 成员表补全（es env）
// ---------------------------------------------------------------------------
describe("console 成员表补全（es env）", () => {
/**
 * 族 29 · es env 的 `console` 成员表不完整 ⇒ 缺成员读出
 * **exact undefined** ⇒ `console.timeStamp()` 折「调用 undefined」=
 * **定抛 TypeError**，而原生**不抛** ⇒ L2 `nudo:entry-may-throw` **假红**。
 *
 * 根因：`packages/env/src/es.ts` 的 `consoleSlots` 是 18 个名字的**手写
 * 白名单**，缺 `timeStamp` / `dirxml` / `profile` / `profileEnd`
 * （node v26 实测存在）——闭对象缺槽读出 exact undefined（不是 unknown）。
 *
 * 断言双向：
 * - 正向：成员表**含** node v26 的公有 console 方法集；调用这些成员
 * **不**产生 entry-may-throw；签名按原生拆（log 变参 / time 收 label? /
 * assert 收 (condition, ...args)）。
 * - 反向：把成员表改回旧白名单 ⇒ 本文件必须失败（成员表断言 + 引擎
 * 诊断断言双侧都会红）。
 */




/** es env 的全局表（≡ service 侧 `collectEnvGlobals(["es"])`）。 */
function esEnvGlobals(): Record<string, Abs> {
  return { ...defineEnv_____es_ts().globals };
}

type CheckResult = ReturnType<typeof checkSource>;

function checkWithEs(src: string): CheckResult {
  resetGeneralizeMemo();
  return checkSource("/t/env-bug-861.js", src, pTrue, {
    inject: { envGlobals: esEnvGlobals() },
  });
}

/** 取 console 对象的某个成员槽（env 声明面）。 */
function consoleMember(name: string): Abs | undefined {
  const consoleAbs = defineEnv_____es_ts().globals.console!;
  expect(consoleAbs.shape.k, "console must be an object").toBe("obj");
  const slots = (consoleAbs.shape as { slots?: Record<string, { value: Abs }> }).slots ?? {};
  return slots[name]?.value;
}

/** fn 形状的形参标签（envFn 写入 shape.params）。 */
function paramsOf(fn: Abs): string[] {
  expect(fn.shape.k).toBe("fn");
  return (fn.shape as { params: string[] }).params;
}

describe("console 成员表补全（es env）", () => {
  it("1. 成员表含 node v26 的公有 console 方法集（旧白名单缺 4 个）", () => {
    // node v26 实测（Object.getOwnPropertyNames(console) 的公有方法面）
    const expected = [
      "log", "info", "debug", "warn", "error", "trace",
      "dir", "dirxml", "table",
      "group", "groupCollapsed", "groupEnd",
      "count", "countReset", "assert", "clear",
      "time", "timeLog", "timeEnd", "timeStamp",
      "profile", "profileEnd",
      "context", "createTask", "Console",
    ];
    for (const name of expected) {
      const fn = consoleMember(name);
      expect(fn, `console.${name} must be declared`).toBeTruthy();
      expect(fn!.shape.k, `console.${name} must be a function`).toBe("fn");
    }
  });

  it("2. 旧白名单缺的 4 个成员调用**不抛**（假红消除）", () => {
    for (const expr of [
      'console.timeStamp("m")',
      "console.dirxml({ a: 1 })",
      'console.profile("m")',
      'console.profileEnd("m")',
    ]) {
      const r = checkWithEs(`export function f() { ${expr}; }`);
      const mayThrow = r.issues.filter((i) => i.code === "nudo:entry-may-throw");
      expect(
        mayThrow.map((i) => i.message),
        `${expr} must not be reported as may-throw`,
      ).toEqual([]);
      // 签名不是 never（旧行为：调用 undefined ⇒ 定抛 TypeError ⇒ never）
      const sig = r.signatures.find((s) => s.name === "f");
      expect(sig, "f must have a signature").toBeTruthy();
      expect(formatShape(sig!.abs), `${expr} signature`).not.toMatch(/\bnever\b/);
    }
  });

  it("3. 签名按原生拆（旧实现全部复用同一个 voidFn ⇒ 形参面失真）", () => {
    // 输出族是变参
    expect(paramsOf(consoleMember("log")!)).toEqual(["...args"]);
    expect(paramsOf(consoleMember("error")!)).toEqual(["...args"]);
    // 计时族收 label?
    expect(paramsOf(consoleMember("time")!)).toEqual(["label?"]);
    expect(paramsOf(consoleMember("timeEnd")!)).toEqual(["label?"]);
    expect(paramsOf(consoleMember("timeStamp")!)).toEqual(["label?"]);
    // 断言族收 (condition, ...args)
    expect(paramsOf(consoleMember("assert")!)).toEqual(["condition", "...args"]);
    // 计数族收 label?
    expect(paramsOf(consoleMember("count")!)).toEqual(["label?"]);
    // 分组结束无参
    expect(paramsOf(consoleMember("groupEnd")!)).toEqual([]);
  });

  it("4. 既有成员面未回归（log/error/warn/info/assert 仍在且可调用）", () => {
    const r = checkWithEs(
      'export function f() { console.log("a", 1); console.error("e"); console.warn("w"); console.info("i"); console.assert(false, "m"); }',
    );
    expect(r.issues.filter((i) => i.code === "nudo:entry-may-throw")).toEqual([]);
    for (const name of ["log", "error", "warn", "info", "assert"]) {
      expect(consoleMember(name), `console.${name}`).toBeTruthy();
    }
  });

  it("5. `new console.Console()` 不因缺槽被误判为定抛 TypeError", () => {
    const r = checkWithEs("export function f() { return new console.Console(); }");
    expect(r.issues.filter((i) => i.code === "nudo:entry-may-throw")).toEqual([]);
    const sig = r.signatures.find((s) => s.name === "f");
    expect(formatShape(sig!.abs)).toContain("Console");
  });
});
});

// ---------------------------------------------------------------------------
// spawnSync 返回域补齐 pid / output / signal
// ---------------------------------------------------------------------------
describe("spawnSync 返回域补齐 pid / output / signal", () => {
/**
 * node env 的 `node:child_process.spawnSync` 返回域是**闭合 4 槽对象**
 * （status / stdout / stderr / error）⇒ 缺 `pid` / `output` / `signal` ⇒
 * `spawnSync(...).pid` 读出 **exact `undefined`**（**错值**：原生是 number）、
 * `spawnSync(...).output[0]` 落「在 undefined 上取下标」⇒ 引擎**证明**
 * 「必抛 TypeError」⇒ L2 门禁**假红**。
 *
 * 原生 oracle（Node v26.10.0 独立进程实测）：
 * Object.keys(spawnSync(process.execPath, ["-e", "0"])) =
 * ["status", "signal", "output", "pid", "stdout", "stderr"]
 * （`error` 只在 spawn 失败时出现——失败时原生**确实**带 error 键）
 * pid = number（进程 pid）
 * output = [null, Buffer, Buffer]（stdio 未接管 stdout 时首项为 null）
 * signal = null（成功时）
 * status = 0（成功时）
 *
 * 新建模：返回域补齐 `pid` / `output` / `signal`（并保留 `error`：spawn 失败时
 * 原生确实带该键）。
 *
 * 断言双向：正向钉住「成员表齐全 + 类型与原生一致」；
 * 反向（把返回域改回 4 槽闭合对象）本文件必须失败。
 */





const env = defineEnv();
const cp = env.modules!["child_process"]!;

/** obj 槽位（obj shape ⇒ slots） */
function slotsOf(a: Abs): Record<string, Abs> {
  const shape = a.shape as { k: string; slots?: Record<string, { value: Abs }> };
  expect(shape.k).toBe("obj");
  const out: Record<string, Abs> = {};
  for (const [k, slot] of Object.entries(shape.slots ?? {})) out[k] = slot.value;
  return out;
}

/** spawnSync 的**声明返回面** */
function declaredFace(): Abs {
  const fn = cp.spawnSync!;
  expect(fn.shape.k).toBe("fn");
  const rt = (fn.shape as { returnType?: Abs }).returnType;
  expect(rt, "spawnSync must declare a return face").toBeTruthy();
  return rt!;
}

describe("spawnSync 返回域补齐 pid / output / signal", () => {
  it("1. 声明返回面含原生全部成员（pid / output / signal / status / stdout / stderr）", () => {
    const slots = slotsOf(declaredFace());
    for (const key of ["pid", "output", "signal", "status", "stdout", "stderr"]) {
      expect(Object.keys(slots), `spawnSync face must expose ${key}`).toContain(key);
    }
  });

  it("2. 原生 oracle 的键集与 env 声明面一致（error 另计：仅 spawn 失败时出现）", () => {
    const native = nodeSpawnSync(process.execPath, ["-e", "0"]);
    const nativeKeys = Object.keys(native).sort();
    const slots = slotsOf(declaredFace());
    const envKeys = Object.keys(slots).filter((k) => k !== "error").sort();
    expect(envKeys).toEqual(nativeKeys);
  });

  it("3. pid 是 number（不是 undefined）；output 元素是 Buffer | null；signal 是 string | null", () => {
    const slots = slotsOf(declaredFace());
    expect(formatShape(slots.pid!)).toBe("number");
    expect(formatShape(slots.output!)).toContain("null");
    expect(formatShape(slots.signal!)).toContain("null");
    expect(formatShape(slots.status!)).toContain("null");
  });

  it("4. 反向对照：旧 4 槽面读 pid 会得到 exact undefined", () => {
    const slots = slotsOf(declaredFace());
    // 旧建模没有 pid 槽 ⇒ 读出 exact undefined（这里必须读得到槽）
    expect(Object.keys(slots)).toContain("pid");
    expect(slots.pid).toBeTruthy();
  });
});
});

// ---------------------------------------------------------------------------
// queueMicrotask keeps core's callable-arg validation
// ---------------------------------------------------------------------------
describe("queueMicrotask keeps core's callable-arg validation", () => {
/**
 * 族 29 web env 的 `queueMicrotask` 声明**挡掉** core 的可调用实参校验。
 *
 * 根因：env 的 `queueMicrotask` 是一条**纯类型声明** ⇒ 引擎把该全局整体换成
 * env 声明路径 ⇒ core 的 `blockHostSideEffect` / `validateCallableArg`
 * （`packages/core/src/algebra/exec/calls.ts:290-298`）**根本没被调用** ⇒
 * 非可调用实参的 TypeError 丢失 ⇒ L2 门禁**假绿**（去掉 env 指令反而判红）。
 *
 * 修法（已实测）：**删掉 web env 的 `queueMicrotask` 声明** ⇒ 回落宿主 ⇒ core
 * 的 `validateCallableArg` 生效 ⇒ 记 TypeError。
 *
 * 原生 oracle（node v26.10.0）：
 * queueMicrotask(1) → TypeError: The "callback" argument must be of type
 * function. Received type number (1)
 *
 * 反向钉：把 `queueMicrotask` 加回 env 全局表 ⇒ 本文件必挂。
 */
describe("queueMicrotask keeps core's callable-arg validation", () => {
  it("queueMicrotask is NOT declared in the web env", () => {
    expect(webEnvGlobals()["queueMicrotask"]).toBeUndefined();
  });

  it("queueMicrotask(1) records TypeError (native throws)", () => {
    const out = checkWeb(`export function f(){ queueMicrotask(1); return 1; }`);
    expect(out.throwBrands).toContain("TypeError");
  });

  it("the env path and the host path agree", () => {
    const withEnv = checkWeb(`export function f(){ queueMicrotask(1); return 1; }`, true);
    const hostOnly = checkWeb(`export function f(){ queueMicrotask(1); return 1; }`, false);
    expect(withEnv.throwBrands).toEqual(hostOnly.throwBrands);
    expect(withEnv.throwBrands).toContain("TypeError");
  });

  it("a callable callback is not reported as a TypeError", () => {
    const out = checkWeb(`export function f(){ queueMicrotask(function () {}); return 1; }`);
    expect(out.throwBrands).not.toContain("TypeError");
  });
});
});

// ---------------------------------------------------------------------------
// node:assert 族有真实 throws 面
// ---------------------------------------------------------------------------
describe("node:assert 族有真实 throws 面", () => {
/**
 * env 的 `node:assert` 族**建模成永不抛** ⇒ L2 门禁**假绿**。
 *
 * 原生 oracle（Node v26.10.0 独立进程实测）：
 * ok(false) ⇒ 抛 AssertionError（ERR_ASSERTION）
 * ok(0) / ok(undefined) ⇒ 抛 AssertionError
 * ok(true) / ok(1) ⇒ 不抛
 * strictEqual(1, 2) ⇒ 抛 AssertionError
 * strictEqual(1, 1) ⇒ 不抛
 * deepStrictEqual({a:1},{a:1}) ⇒ 不抛；{a:1} vs {a:2} ⇒ 抛 AssertionError
 * notStrictEqual(1, 1) ⇒ 抛 AssertionError；notStrictEqual(1, 2) ⇒ 不抛
 * match("abc", /b/) ⇒ 不抛；match("abc", /z/) ⇒ 抛 AssertionError
 * fail() / fail("boom") ⇒ **恒抛** AssertionError
 * strictEqual(1)（缺参） ⇒ 抛 TypeError [ERR_MISSING_ARGS]（**不是** AssertionError）
 *
 * 旧实现：六个函数全是 relation 面（**恒不抛**）⇒ 六个必抛入口一次放行（假绿）。
 *
 * 新建模（走 core 的 throws 通道）：
 * - 实参可判定且断言**失败** ⇒ **必抛**（abs 面 = never + AssertionError）；
 * - 实参可判定且断言**成立** ⇒ **零抛**（裸 Abs 返回）；
 * - 实参**判不出**（抽象值 / 抽象 pattern）⇒ **may-throw**（原生在该域上确实可能抛）。
 *
 * 断言双向：正向钉住「失败必抛 / 成立零抛 / 抽象 may-throw」；
 * 反向（把 apply 改回旧的 `undefined` 回落）本文件必须失败。
 */







const env = defineEnv();
const assertMod = env.modules!.assert!;

/** RegExp brand（引擎里正则字面量就是这个形状：source / flags 槽） */
function regexpOf(source: string, flags = ""): Abs {
  return brandOf("RegExp", objAbs({ source: strLit(source), flags: strLit(flags) }));
}

/** 抽象值（判不出真值 / 相等性） */
const ABSTRACT = prim.str();

/** 原生 oracle：调用 fn，取原生抛出的错误名（不抛 ⇒ undefined） */
function nativeErrorName(fn: () => void): string | undefined {
  try {
    fn();
    return undefined;
  } catch (e) {
    return (e as Error).name;
  }
}

describe("node:assert 族有真实 throws 面", () => {
  it("1. ok(false) ⇒ 必抛 AssertionError（旧实现恒不抛）", () => {
    // 原生 oracle：ok(false) 抛 AssertionError
    expect(nativeErrorName(() => nodeOk(false))).toBe("AssertionError");
    const site = callSite____env_bug_s4_helpers_ts_1(assertMod.ok!, [boolLit(false)]);
    expect(site.threw, "ok(false) must throw (always-throw)").toBeTruthy();
    expect(thrownBrand(site.threw)).toBe("AssertionError");
    expect(site.exits).toHaveLength(0);
  });

  it("2. ok(true) ⇒ 零抛（断言成立）", () => {
    const site = callSite____env_bug_s4_helpers_ts_1(assertMod.ok!, [boolLit(true)]);
    expect(site.threw).toBeUndefined();
    expect(site.exits).toHaveLength(0);
  });

  it("3. ok(抽象值) ⇒ may-throw AssertionError（原生在该域上确实可能抛）", () => {
    const site = callSite____env_bug_s4_helpers_ts_1(assertMod.ok!, [ABSTRACT]);
    expect(site.threw, "abstract arg must not be a hard throw").toBeUndefined();
    expect(site.exits).toHaveLength(1);
    expect(brandName____env_bug_s4_helpers_ts(site.exits[0]!)).toBe("AssertionError");
  });

  it("4. strictEqual(1, 2) ⇒ 必抛 AssertionError；strictEqual(1, 1) ⇒ 零抛", () => {
    const bad = callSite____env_bug_s4_helpers_ts_1(assertMod.strictEqual!, [numLit(1), numLit(2)]);
    expect(bad.threw).toBeTruthy();
    expect(thrownBrand(bad.threw)).toBe("AssertionError");

    const good = callSite____env_bug_s4_helpers_ts_1(assertMod.strictEqual!, [numLit(1), numLit(1)]);
    expect(good.threw).toBeUndefined();
    expect(good.exits).toHaveLength(0);
  });

  it("5. deepStrictEqual ⇒ 结构判定：相等零抛 / 不等必抛", () => {
    const same = callSite____env_bug_s4_helpers_ts_1(assertMod.deepStrictEqual!, [
      objAbs({ a: numLit(1) }),
      objAbs({ a: numLit(1) }),
    ]);
    expect(same.threw).toBeUndefined();
    expect(same.exits).toHaveLength(0);

    const diff = callSite____env_bug_s4_helpers_ts_1(assertMod.deepStrictEqual!, [
      objAbs({ a: numLit(1) }),
      objAbs({ a: numLit(2) }),
    ]);
    expect(diff.threw).toBeTruthy();
    expect(thrownBrand(diff.threw)).toBe("AssertionError");
  });

  it("6. notStrictEqual ⇒ 相等必抛 / 不等零抛", () => {
    const same = callSite____env_bug_s4_helpers_ts_1(assertMod.notStrictEqual!, [numLit(1), numLit(1)]);
    expect(same.threw).toBeTruthy();
    expect(thrownBrand(same.threw)).toBe("AssertionError");

    const diff = callSite____env_bug_s4_helpers_ts_1(assertMod.notStrictEqual!, [numLit(1), numLit(2)]);
    expect(diff.threw).toBeUndefined();
    expect(diff.exits).toHaveLength(0);
  });

  it("7. match ⇒ pattern 可判定时精确判定：命中零抛 / 不命中必抛", () => {
    const hit = callSite____env_bug_s4_helpers_ts_1(assertMod.match!, [strLit("abc"), regexpOf("b")]);
    expect(hit.threw).toBeUndefined();
    expect(hit.exits).toHaveLength(0);

    const miss = callSite____env_bug_s4_helpers_ts_1(assertMod.match!, [strLit("abc"), regexpOf("z")]);
    expect(miss.threw).toBeTruthy();
    expect(thrownBrand(miss.threw)).toBe("AssertionError");
  });

  it("8. fail() ⇒ 恒抛 AssertionError", () => {
    // 原生 oracle：fail() 恒抛
    expect(nativeErrorName(() => nodeFail("boom"))).toBe("AssertionError");
    const site = callSite____env_bug_s4_helpers_ts_1(assertMod.fail!, []);
    expect(site.threw).toBeTruthy();
    expect(thrownBrand(site.threw)).toBe("AssertionError");
  });

  it("9. strictEqual 缺参 ⇒ 必抛 TypeError（原生 ERR_MISSING_ARGS，不是 AssertionError）", () => {
    // 原生 oracle：strictEqual(1) 缺参 ⇒ TypeError（不是 AssertionError）
    expect(nativeErrorName(() => (nodeStrictEqual as (a: unknown, b?: unknown) => void)(1))).toBe(
      "TypeError",
    );
    const site = callSite____env_bug_s4_helpers_ts_1(assertMod.strictEqual!, [numLit(1)]);
    expect(site.threw).toBeTruthy();
    expect(thrownBrand(site.threw)).toBe("TypeError");
  });
});
});

// ---------------------------------------------------------------------------
// node:util 品牌形参函数：具名导入调用面不得 L2 假红
// ---------------------------------------------------------------------------
describe("node:util 品牌形参函数：具名导入调用面不得 L2 假红", () => {
/**
 * （族 29 · S6）—— **core 侧根因**回归钉。
 *
 * 现象：`node:util` 的**品牌形参**函数（`promisify` / `callbackify` /
 * `inherits` / `isDeepStrictEqual`）在**具名导入**调用面
 * （`import { promisify } from "node:util"` ⇒ `promisify(readFile)`）
 * ⇒ **L2 门禁假红**（native 必不抛，引擎却记 `may throw TypeError`），
 * 而**成员调用**面（`util.promisify(readFile)`）完全正常
 * ⇒ 同一函数**两种口径**。
 *
 * 根因（core 侧）：的**实参归一化**只补在 `$invoke`（成员调用面），
 * 没补在**普通调用面**（具名导入 / 直接调用）。普通调用面把**裸宿主值**
 * （宿主函数 / 宿主构造器 / 用户函数声明——transpile 侧直发 host function）
 * 原样灌进 `bindTypeVars`（`packages/core/src/algebra/hof.ts`）
 * ——`arg.shape` 解引用 `undefined` ⇒ TypeError 冒泡
 * ⇒ 上层当成「这个调用可能抛」⇒ 记 may TypeError ⇒ **L2 假红**。
 *
 * 修法（core · S6）：
 * 1. `packages/core/src/algebra/hof.ts` 的 `bindTypeVars`：实参**无形状**
 * ⇒ **不参与类型变量绑定**（不再崩）。
 * 2. **普通调用面也做实参归一化**（与
 * `packages/core/src/algebra/exec/class/invoke.ts` 的 段同款）：
 * `hof.ts` 的 `setRawArgNormalizer` 注册 `asAbsVal` 门面
 * ⇒ 成员调用面 / 普通调用面共用同一门面 ⇒ **两种口径一致**。
 *
 * 本钉直接驱动引擎（core 的 `checkSource` + env 模块直注），
 * 不经 service 的 `@nudo:env` 指令层。
 *
 * ⚠️ 与 S4 的 `env--util-brand-params.part.ts`（env 侧：给
 * `node:util` 四兄弟加 `apply`，建模侧规避）**互补**：本钉的**判别钉**
 * 走 `fs.readFile(path, enc, cb)`（仍是 relation 形态 ⇒ 只由 core 侧
 * 修复兜住）+ 一条 core API 直钉 ⇒ **拆掉 core 修复 ⇒ 本文件必红**。
 */





const nodeEnv = defineEnv();

/** env 的 `brandOf("Function")` 形状（品牌形参面） */
const fnBrand = abs(
  { k: "brand", name: "Function", shape: abs({ k: "unknown" }, undefined, undefined, "path") },
  undefined,
  undefined,
  "path",
);

/** 裸宿主函数 / 宿主构造器（普通调用面的实参——无 Abs 形状） */
const rawHostFn = function Sub() {};
const rawHostCtor = Object;

/** env 模块表 → core 的模块导出表（与 service 的 `collectEnvModules` 同口径） */
function modulesOf(def: {
  modules?: Record<string, Record<string, Abs>>;
}): Record<string, AbsModuleExports> {
  const out: Record<string, AbsModuleExports> = {};
  for (const [spec, named] of Object.entries(def.modules ?? {})) {
    out[spec] = { named: { ...named } };
  }
  return out;
}

const NODE_MODULES = modulesOf(nodeEnv);

function check(src: string) {
  resetGeneralizeMemo();
  return checkSource("/t/x.js", src, pTrue, {
    modules: NODE_MODULES,
    inject: { envGlobals: nodeEnv.globals, modules: NODE_MODULES },
  });
}

function codesOf(src: string): string[] {
  return check(src).issues.map((i) => i.code);
}

function sigOf(src: string, name: string): { display: string; throws?: string } {
  const sig = check(src).signatures.find((s) => s.name === name);
  expect(sig, `signature "${name}" missing`).toBeTruthy();
  return { display: sig!.display, throws: sig!.throws };
}

/** L2 入口 may-throw 门禁（假红就是它） */
const MAY_THROW = "nudo:entry-may-throw";

describe("node:util 品牌形参函数：具名导入调用面不得 L2 假红", () => {
  const NAMED = `/// @nudo:env node
import { promisify } from "node:util";
import { readFile } from "node:fs";
export function use() { return promisify(readFile); }
`;

  const MEMBER = `/// @nudo:env node
import * as util from "node:util";
import { readFile } from "node:fs";
export function use() { return util.promisify(readFile); }
`;

  it("具名导入调用面：promisify(readFile) 零 L2（native 必不抛）", () => {
    const codes = codesOf(NAMED);
    expect(codes, `L2 假红：${codes.join(", ")}`).not.toContain(MAY_THROW);
    expect(sigOf(NAMED, "use").throws).toBeUndefined();
  });

  it("成员调用面：util.promisify(readFile) 零 L2", () => {
    const codes = codesOf(MEMBER);
    expect(codes, `L2 假红：${codes.join(", ")}`).not.toContain(MAY_THROW);
    expect(sigOf(MEMBER, "use").throws).toBeUndefined();
  });

  it("两种调用口径一致（具名导入 == 成员调用）", () => {
    expect(sigOf(NAMED, "use").display).toBe(sigOf(MEMBER, "use").display);
  });

  it("裸宿主函数实参（inherits(Sub, Object)）零 L2 —— 普通调用面不得崩", () => {
    const src = `/// @nudo:env node
import { inherits } from "node:util";
export function Sub() {}
export function use() { return inherits(Sub, Object); }
`;
    const codes = codesOf(src);
    expect(codes, `L2 假红：${codes.join(", ")}`).not.toContain(MAY_THROW);
    // 崩溃回落会给出 `unknown` + throws TypeError；修好后是确定的 undefined
    const sig = sigOf(src, "use");
    expect(sig.throws).toBeUndefined();
    expect(sig.display).not.toMatch(/unknown/);
  });

  it("裸宿主值实参（isDeepStrictEqual）零 L2", () => {
    const src = `/// @nudo:env node
import { isDeepStrictEqual } from "node:util";
export function use(a, b) { return isDeepStrictEqual(a, b); }
`;
    const codes = codesOf(src);
    expect(codes, `L2 假红：${codes.join(", ")}`).not.toContain(MAY_THROW);
  });

  it("裸宿主函数实参（fs 同步族的回调位）零 L2 —— 钉住 core 侧根因", () => {
    // **判别钉**：函数**声明**绑定是裸宿主函数（transpile 直发 host
    // function）⇒ 普通调用面把它原样灌进 relation 实例化 ⇒
    // `bindTypeVars` 解引用 `arg.shape` ⇒ TypeError 冒泡 ⇒ L2 假红。
    // 改前：`use() => unknown throws TypeError` + `nudo:entry-may-throw`；
    // 改后：`use() => undefined`，零 L2。
    // （`node:util` 四兄弟另有 env 侧 apply 规避；本钉走 `fs.readFile`
    // ——仍是 relation 形态 ⇒ 只由 core 侧修复兜住。）
    const src = `/// @nudo:env node
import { readFile } from "node:fs";
function cb(err, data) { return data; }
export function use() { return readFile("x.txt", "utf8", cb); }
`;
    const codes = codesOf(src);
    expect(codes, `L2 假红：${codes.join(", ")}`).not.toContain(MAY_THROW);
    const sig = sigOf(src, "use");
    expect(sig.throws).toBeUndefined();
    expect(sig.display).not.toMatch(/unknown/);
  });

  it("core 侧根因直钉：relation 实例化遇裸宿主实参不得抛", () => {
    // `instantiateReturn`（packages/core/src/algebra/hof.ts）是普通调用面
    // 把 relation fn 实例化的入口；裸宿主实参此前在此解引用
    // `arg.shape` ⇒ TypeError。
    const rel = relationFn([fnBrand], undefAbs());
    expect(() => instantiateReturn(rel, [rawHostFn as never])).not.toThrow();
    expect(() => instantiateReturn(rel, [rawHostCtor as never])).not.toThrow();
  });

  it("反向对照：真会抛的入口必须报 L2（防永真断言）", () => {
    const src = `export function use() { throw new Error("boom"); }
`;
    expect(codesOf(src)).toContain(MAY_THROW);
  });

  it("反向对照：真会抛的宿主调用必须报 L2（防永真断言）", () => {
    const src = `/// @nudo:env node
import { readFileSync } from "node:fs";
export function use() { return readFileSync("/definitely/not/here.txt", "utf8"); }
`;
    // env 的 fs 同步族声明了 throws 面 ⇒ 真会抛 ⇒ 必须报
    expect(codesOf(src)).toContain(MAY_THROW);
  });
});
});

// ---------------------------------------------------------------------------
// node:util 品牌形参不参与类型变量绑定（env 侧）
// ---------------------------------------------------------------------------
describe("node:util 品牌形参不参与类型变量绑定（env 侧）", () => {
/**
 * `node:util` 的**品牌形参**函数（promisify / callbackify / inherits /
 * isDeepStrictEqual）在**具名导入**调用下 ⇒ L2 门禁**假红**（原生必不抛）。
 *
 * 原生 oracle（Node v26.10.0 独立进程实测）：
 * promisify(readFile) / callbackify(asyncFn) / inherits(Sub, Object) /
 * isDeepStrictEqual({a:1},{a:1}) —— **一个都不抛**。
 *
 * 旧实现：这四个函数是 relation 面 ⇒ 调用走 core 的 relation 实例化
 * （`bindTypeVars` 做类型变量绑定）。**具名导入**调用时实参可能是**裸宿主值**
 * （宿主函数 / 用户函数声明）⇒ 品牌形参参与绑定时会在代数解引用点炸掉 ⇒
 * 上层记「可能抛 TypeError」⇒ L2 门禁假红（同一函数**成员调用**却完全正常）。
 *
 * 本文件钉的是 **env 侧**那一半（core 侧由 S6 负责：调用面实参归一化 +
 * 绑定保护）：
 * - 这四个函数走 **apply 面** ⇒ **不进入 relation 实例化** ⇒ 品牌形参
 * **不参与类型变量绑定**（建模侧规避，不依赖实参是否已被归一化）；
 * - 签名面（paramTypes / returnType）**不变** ⇒ format 仍是
 * "(Function, Function) => undefined" 这类干净文本。
 *
 * 断言双向：正向钉住「有 apply + 裸宿主实参不炸 + 签名不变」；
 * 反向（把 apply 去掉、改回 relation 面）本文件必须失败。
 */







const env = defineEnv();
const util = env.modules!.util!;

/** 裸宿主函数（**不是** Abs）——具名导入调用时引擎拿到的就是这种实参 */
const HOST_FN = function Sub(): void {};

describe("node:util 品牌形参不参与类型变量绑定（env 侧）", () => {
  it("1. 四个品牌形参函数都走 apply 面 ⇒ 不进 relation 实例化", () => {
    for (const fn of [util.promisify, util.callbackify, util.inherits, util.isDeepStrictEqual]) {
      expect(fn, "node:util member must exist").toBeTruthy();
      expect(
        getFnImpl(fn!)?.apply,
        "brand-param util fn must take the apply path (no type-var binding)",
      ).toBeTypeOf("function");
    }
  });

  it("2. 裸宿主实参 ⇒ 不炸、不记 may-throw、返回值仍是声明面", () => {
    const inheritsSite = callSite____env_bug_s4_helpers_ts_2(util.inherits!, [HOST_FN as unknown as Abs, HOST_FN as unknown as Abs]);
    expect(inheritsSite.threw, "inherits must not blow up on a raw host fn").toBeUndefined();
    expect(inheritsSite.exits).toHaveLength(0);
    expect(formatShape(inheritsSite.value!)).toBe("undefined");

    const promisifySite = callSite____env_bug_s4_helpers_ts_2(util.promisify!, [HOST_FN as unknown as Abs]);
    expect(promisifySite.threw).toBeUndefined();
    expect(promisifySite.exits).toHaveLength(0);
    expect(formatShape(promisifySite.value!)).toBe("PromiseFn");

    const callbackifySite = callSite____env_bug_s4_helpers_ts_2(util.callbackify!, [HOST_FN as unknown as Abs]);
    expect(callbackifySite.threw).toBeUndefined();
    expect(callbackifySite.exits).toHaveLength(0);
    expect(formatShape(callbackifySite.value!)).toBe("CallbackFn");

    const deepSite = callSite____env_bug_s4_helpers_ts_2(util.isDeepStrictEqual!, [
      HOST_FN as unknown as Abs,
      HOST_FN as unknown as Abs,
    ]);
    expect(deepSite.threw).toBeUndefined();
    expect(deepSite.exits).toHaveLength(0);
    expect(formatShape(deepSite.value!)).toBe("boolean");
  });

  it("3. 签名面不变（品牌形参仍在签名里，format 干净）", () => {
    expect(formatShape(util.inherits!)).toBe("(Function, Function) => undefined");
    expect(formatShape(util.promisify!)).toBe("(CallbackFn) => PromiseFn");
    expect(formatShape(util.callbackify!)).toBe("(PromiseFn) => CallbackFn");
    expect(formatShape(util.isDeepStrictEqual!)).toBe("(Value, Value) => boolean");
    // format 不得漏出 unknown / any（产品语义：unknown = 推断失败）
    for (const fn of [util.inherits!, util.promisify!, util.callbackify!, util.isDeepStrictEqual!]) {
      expect(formatShape(fn)).not.toMatch(/(^|[^\w])(unknown|any)([^\w]|$)/);
    }
  });

  it("4. 原生 oracle：inherits / promisify 都不抛", () => {
    // 原生：inherits(Sub, Object) 与 promisify(readFile) 都不抛
    expect(() => nodeInherits(HOST_FN, Object)).not.toThrow();
    expect(() => nodePromisify(readFile)).not.toThrow();
  });

  it("5. 反向对照：品牌形参的 throws 面不得凭空出现（旧假红路径）", () => {
    const site = callSite____env_bug_s4_helpers_ts_2(util.inherits!, [HOST_FN as unknown as Abs, HOST_FN as unknown as Abs]);
    expect(site.exits).toHaveLength(0);
    expect(brandName____env_bug_s4_helpers_ts_1(site.exits[0])).toBeUndefined();
  });
});
});

// ---------------------------------------------------------------------------
// util.types models every host predicate
// ---------------------------------------------------------------------------
describe("util.types models every host predicate", () => {
/**
 * 族 15 · `util.types` 是**封闭对象**且只建模 **8** 个谓词，
 * 宿主上有 **43** 个（缺 35，含 `isMap` / `isSet` / `isProxy` /
 * `isWeakMap` / `isUint8Array` …）⇒ 缺的成员读出 **exact `undefined`**
 * ⇒ `types.isMap(new Map())` 被判「确定抛 TypeError」⇒ L2 门禁假红（exit 1）。
 *
 * 修法：按宿主成员集补齐（全部 `(value) => boolean`）+ 宿主实测护栏。
 *
 * 反向钉：删掉任一补上的谓词 ⇒ 差分断言必挂。
 */
describe("util.types models every host predicate", () => {
  it("host oracle: the predicates in question exist and return true", () => {
    expect(hostTypes.isMap(new Map())).toBe(true);
    expect(hostTypes.isSet(new Set())).toBe(true);
    expect(hostTypes.isDate(new Date())).toBe(true);
    expect(Object.keys(hostTypes).length).toBeGreaterThanOrEqual(43);
  });

  it("the env member set covers every host util.types predicate", () => {
    const declared = new Set(memberNames(envMember("node:util", "types")));
    const missing = Object.keys(hostTypes).filter((k) => !declared.has(k));
    expect(missing, `util.types is missing: ${missing.join(", ")}`).toEqual([]);
  });

  it("types.isMap applies to boolean and never throws", () => {
    const isMap = slotOfAbs(envMember("node:util", "types"), "isMap")!;
    const r = callSite(isMap, [unknown]);
    expect(formatShape(r.value!)).toBe("boolean");
    expect(r.exits).toEqual([]);
  });

  it("types.isMap(...) via the module face applies cleanly", () => {
    const types = envMember("node:util", "types");
    const names = memberNames(types);
    expect(names).toContain("isMap");
    expect(names).toContain("isSet");
    expect(names).toContain("isDate");
    // 每个补上的谓词都是 (any) => boolean
    for (const name of ["isMap", "isSet", "isProxy", "isWeakMap", "isUint8Array"]) {
      const slot = (types.shape as { slots: Record<string, { value: { shape: { k: string } } }> })
        .slots[name]!;
      expect(slot.value.shape.k, `util.types.${name} must be a fn`).toBe("fn");
    }
  });
});
});
