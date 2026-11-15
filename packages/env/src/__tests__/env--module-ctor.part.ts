/**
 * Bug 866 — env node：`node:url` / `node:util` 的**模块导出构造器缺 `ctor: true`**
 * ⇒ 合法 `new URL(…)` / `new TextEncoder()` 被判**定抛 TypeError**（**假红**）。
 *
 * 原生 oracle（Node v26.10.0 独立进程实测）：
 *   new URL("https://x.dev/a")      → OK（href = "https://x.dev/a"）
 *   new URLSearchParams("a=1")      → OK
 *   new TextEncoder()               → OK
 *   new TextDecoder("utf-8")        → OK
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
import { describe, it, expect } from "vitest";
import { $new, strLit, type Abs } from "@nudojs/core";
import { runWithMayThrowSession, setMayThrowCollector } from "@nudojs/core/internal";
import { defineEnv } from "../node.ts";

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

describe("Bug 866 · env node 模块导出构造器带 ctor:true", () => {
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
