/**
 * B-path try/catch 软 may-throw 的 rethrow 语义回归：
 * try { u.name } catch (e) { throw e; }——假想 soft throw（u 为 nullish 时
 * TypeError）经 catch rethrow 逃逸，L2 必须保留。此前 transpile 在正常
 * 完成路径无条件 $tryDigestSoftCatch()：抽象执行里 try 体正常返回（Abs
 * 不真抛），soft 帧被消化丢弃——collector 收不到任何效果，check 的
 * entry-may-throw gold 漏报。修法：catch 体内含 throw（含条件 throw，
 * 与 evalTry 行为口径一致）→ 正常路径 $tryReleaseSoftCatch()（摘帧上浮
 * 到 collector/外层帧）而非 digest。
 */
import { describe, it, expect } from "vitest";
import {
  runTranspiled,
  callTranspiledExportFull,
  abs,
  litValue,
} from "@nudojs/core";
import {
  runWithMayThrowSession,
  setMayThrowCollector,
  type MayThrowEffect,
} from "../exec/may-throw.ts";
import { analyzeFnFull } from "../ast-eval.ts";

const anyAbs = abs({ k: "any" }, undefined, undefined, "path");

function collect(src: string, fnName = "f", args: unknown[] = [anyAbs]): MayThrowEffect[] {
  const effects: MayThrowEffect[] = [];
  runWithMayThrowSession(() => {
    setMayThrowCollector((e) => effects.push(e));
    try {
      const run = runTranspiled(src, { mode: "analyze" });
      callTranspiledExportFull(run, fnName, args as never[]);
    } catch {
      /* probe 忽略 */
    }
    setMayThrowCollector(null);
  });
  return effects;
}

describe("B-path soft may-throw rethrow", () => {
  it("catch rethrow keeps the soft effect (L2 gold)", () => {
    const effects = collect(`export function f(u) {
  try { return u.name; } catch (e) { throw e; }
}`);
    expect(effects.map((e) => e.kind)).toContain("TypeError");
  });

  it("catch that handles (returns) digests the soft effect", () => {
    const effects = collect(`export function f(u) {
  try { return u.name; } catch (e) { return 1; }
}`);
    expect(effects).toEqual([]);
  });

  it("conditional throw in catch keeps the effect (conservative orphan)", () => {
    const effects = collect(`export function f(u) {
  try { return u.name; } catch (e) { if (u) throw e; return 1; }
}`);
    expect(effects.map((e) => e.kind)).toContain("TypeError");
  });

  it("nested: inner rethrow orphaned into outer frame, outer catch digests", () => {
    const effects = collect(`export function f(u) {
  try {
    try { return u.name; } catch (e) { throw e; }
  } catch (e) { return 0; }
}`);
    expect(effects).toEqual([]);
  });

  it("throw inside nested function declared in catch is NOT a rethrow", () => {
    const effects = collect(`export function f(u) {
  try { return u.name; } catch (e) {
    const h = () => { throw e; };
    return 1;
  }
}`);
    expect(effects).toEqual([]);
  });

  it("hard throw rethrow unchanged (throws domain)", () => {
    const run = runTranspiled(
      `export function f() { try { throw new Error('x'); } catch (e) { throw e; } }`,
      { mode: "analyze" },
    );
    const full = callTranspiledExportFull(run, "f", []);
    expect((full.throws as { shape?: { name?: string } }).shape?.name).toBe("Error");
    expect(litValue(full.result)).toBeUndefined(); // never
  });

  it("plain may-throw without try still reports (collector path)", () => {
    const effects = collect(`export function f(u) { return u.name; }`);
    expect(effects.map((e) => e.kind)).toContain("TypeError");
  });
});

describe("any-recv promotion keeps L2 may-throw (decoupled from dispatch)", () => {
  // design §3.3：any 危险操作记 may-throw。提升（挂载点①）是使用意图假设，
  // 不消除危险——此前 dispatch 成功后 note 路径不执行，假设被静默隐藏；
  // 现在提升成功后仍按原始 any 接收者记效果。两引擎口径一致。
  const src = `export function sumAges(ages) { return ages.reduce((acc, a) => acc + a, 0); }`;

  it("B-path records TypeError for any-recv array method", () => {
    expect(collect(src, "sumAges").map((e) => e.kind)).toContain("TypeError");
  });

  it("ast-eval records TypeError after promotion", () => {
    const effects: MayThrowEffect[] = [];
    runWithMayThrowSession(() => {
      setMayThrowCollector((e) => effects.push(e));
      try {
        analyzeFnFull(src, "sumAges", [anyAbs], {});
      } catch {
        /* probe 忽略 */
      }
      setMayThrowCollector(null);
    });
    expect(effects.map((e) => e.kind)).toContain("TypeError");
  });
});
