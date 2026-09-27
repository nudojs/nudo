/**
 * strict 写语义：非对象目标的成员写（ESM/严格模式原生 TypeError）。
 * 此前 $set/$idxSet 对 prim/空值目标静默造 $obj（假精确 + L2 漏报）。
 * 同时覆盖 top-level this 的 ESM 语义（this → undefined；写 → TypeError）。
 */
import { describe, it, expect } from "vitest";
import {
  runTranspiled,
  callTranspiledExportFull,
  $set,
  $idxSet,
  $lit,
  isNudoThrow,
  abs,
  num,
  unknown as unknownAbs,
  objOf,
  $arr,
  formatAbs,
  litValue,
} from "@nudojs/core";

describe("strict write semantics: non-object targets", () => {
  it("$set / $idxSet on undefined|null|prim literal throw TypeError (NudoThrow)", () => {
    for (const target of [$lit(undefined), $lit(null), $lit(5), $lit("s"), $lit(true)]) {
      let threw = false;
      try {
        $set(target, "x", $lit(1));
      } catch (e) {
        threw = isNudoThrow(e);
      }
      expect(threw, `$set on ${formatAbs(target)}`).toBe(true);
      threw = false;
      try {
        $idxSet(target, $lit(0), $lit(1));
      } catch (e) {
        threw = isNudoThrow(e);
      }
      expect(threw, `$idxSet on ${formatAbs(target)}`).toBe(true);
    }
  });

  it("$set on prim-typed (not literal) target also throws", () => {
    let threw = false;
    try {
      $set(abs(num().shape, undefined, undefined, "path"), "x", $lit(1));
    } catch (e) {
      threw = isNudoThrow(e);
    }
    expect(threw).toBe(true);
  });

  it("$set on any/unknown target is soft may-throw, no fabricated object", () => {
    // 抽象目标：可能成功（对象）也可能 TypeError（空值/prim）——不得造 $obj
    const r = $set(unknownAbs, "x", $lit(1));
    expect(formatAbs(r)).toContain("unknown");
  });

  it("B run: top-level `this` reads as undefined (ESM)", () => {
    const run = runTranspiled(`export function f() { return this; }`, { mode: "analyze" });
    // 函数内 this 已由 transpile 降级；顶层读：
    const run2 = runTranspiled(`export const t = this; export function f() { return 1; }`, { mode: "analyze" });
    expect(litValue(run2.t as never)).toBeUndefined();
    expect(run).toBeDefined();
  });

  it("B run: top-level `this.x = 1` fails module load with TypeError (ESM)", () => {
    let threw = false;
    try {
      runTranspiled(`this.x = 1; export function f() { return 1; }`, { mode: "analyze" });
    } catch (e) {
      threw = isNudoThrow(e);
    }
    expect(threw).toBe(true);
  });

  it("member write on undefined arg reports may-throw through call API", () => {
    const src = `export function f(o) { o.x = 1; return o; }`;
    const run = runTranspiled(src, { mode: "analyze" });
    const r = callTranspiledExportFull(run, "f", [$lit(undefined)]);
    expect(formatAbs(r.throws)).toContain("TypeError");
  });

  it("try/catch absorbs the strict write TypeError", () => {
    const src = `export function f(o) { try { o.x = 1; } catch (e) { return 2; } return 1; }`;
    const run = runTranspiled(src, { mode: "analyze" });
    const r = callTranspiledExportFull(run, "f", [$lit(undefined)]);
    expect(formatAbs(r.result)).toContain("2");
  });

  it("computed-key write on object lands (was silent no-op)", () => {
    const src = `export function f(o, k) { o[k] = 1; return o; }`;
    const run = runTranspiled(src, { mode: "analyze" });
    const o = objOf({ a: { value: $lit(1) } });
    const r = callTranspiledExportFull(run, "f", [o, $lit("b")]);
    // 具体键：槽位落地（此前 { a: 1 } #exact 假精确）
    expect(formatAbs(r.result)).toContain("b: 1");
  });

  it("abstract-key write on object widens (no fabrication, no throw)", () => {
    const src = `export function f(o, k) { o[k] = 1; return o; }`;
    const run = runTranspiled(src, { mode: "analyze" });
    const o = objOf({ a: { value: $lit(1) } });
    const r = callTranspiledExportFull(run, "f", [o, unknownAbs]);
    expect(formatAbs(r.result)).toContain("a: 1");
  });

  it("expando write on array does not fabricate an object", () => {
    const src = `export function f(a) { a.x = 1; return a; }`;
    const run = runTranspiled(src, { mode: "analyze" });
    const arr = $arr([$lit(1), $lit(2)]);
    const r = callTranspiledExportFull(run, "f", [arr]);
    const s = formatAbs(r.result);
    expect(s).not.toContain("{ x: 1 }");
  });
});
