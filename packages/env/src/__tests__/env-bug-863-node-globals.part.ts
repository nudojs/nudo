/**
 * Bug 863 — env node：全局清单只覆盖 41/139；未建模的宿主构造器被 core 的
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
import { describe, it, expect } from "vitest";
import { checkSource, pTrue, formatShape } from "@nudojs/core";
import type { Abs } from "@nudojs/core";
import { defineEnv } from "../node.ts";

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

describe("Bug 863 — node env 全局清单补齐（未建模构造器不再铸空 brand）", () => {
  it("原生 oracle：报告点名的 17 个构造器在真实 Node 上确实存在", () => {
    // 报告的 17 个构造器（可构造的）+ 真实 Node 上确实可 new
    for (const [name, ctor] of [
      ["AbortController", AbortController],
      ["Blob", Blob],
      ["BroadcastChannel", BroadcastChannel],
      ["CustomEvent", CustomEvent],
      ["DOMException", DOMException],
      ["Event", Event],
      ["EventTarget", EventTarget],
      ["File", File],
      ["MessageChannel", MessageChannel],
      ["ReadableStream", ReadableStream],
      ["Request", Request],
      ["Response", Response],
      ["TransformStream", TransformStream],
      ["URLPattern", URLPattern],
      ["WritableStream", WritableStream],
    ] as const) {
      expect(typeof ctor, name).toBe("function");
    }
    // 原生不可构造的（Illegal constructor / 不能 new）——引擎须同口径
    expect(() => new AbortSignal()).toThrow(TypeError);
    expect(() => new MessagePort()).toThrow(TypeError);
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
