/**
 * DEC-003 / F2-missing-export-silent-unknown + F2-evalexports-drops-undefined-named：
 * - re-export 缺名：named[exported]=unknown 而非 continue 丢槽
 * - export let x / export default undefined：保留槽位（名存在 ≠ 从未导出）
 */
import { describe, it, expect } from "vitest";
import { parseSource } from "../parse-source.ts";
import { emptyEnv } from "../ast-env.ts";
import { collectAbsExports, type AbsModuleExports } from "../abs-modules.ts";
import { unknown, abs, num } from "../abs.ts";
import { undefAbs } from "../hof.ts";

function numMod(): AbsModuleExports {
  return {
    named: { a: abs(num().shape, undefined, undefined, "exact") },
  };
}

describe("collectAbsExports slot preservation (DEC-003)", () => {
  it("re-export missing name keeps named[exported]=unknown (no continue drop)", () => {
    const file = parseSource(`export { nope } from "./m.js";`);
    const out = collectAbsExports(file, emptyEnv(), { "./m.js": numMod() });
    expect(out.named.nope).toBeDefined();
    expect(out.named.nope).toBe(unknown);
  });

  it("re-export missing default keeps the default slot as unknown", () => {
    const file = parseSource(`export { default as d } from "./m.js";`);
    const out = collectAbsExports(file, emptyEnv(), { "./m.js": numMod() });
    expect(out.named.d).toBeDefined();
    expect(out.named.d).toBe(unknown);
  });

  it("export let x keeps the named slot even when lookup misses", () => {
    const file = parseSource(`export let x;`);
    const out = collectAbsExports(file, emptyEnv());
    expect(out.named.x).toBeDefined();
  });

  it("export default undefined keeps the default slot", () => {
    const file = parseSource(`export default undefined;`);
    const out = collectAbsExports(file, emptyEnv());
    expect(out.default).toBeDefined();
    expect(out.default!.term).toEqual({ op: "lit", value: undefined });
    expect(out.default!.conf).toBe("exact");
  });

  it("export default undefined is distinguishable from no default export", () => {
    const withDefault = collectAbsExports(parseSource(`export default undefined;`), emptyEnv());
    const withoutDefault = collectAbsExports(parseSource(`export const a = 1;`), emptyEnv());
    expect(withDefault.default).toBeDefined();
    expect(withoutDefault.default).toBeUndefined();
  });

  it("declared export with a bound value keeps that value (undefAbs path unchanged)", () => {
    const file = parseSource(`export const a = 1;`);
    const env = emptyEnv();
    env.vars.set("a", abs(num().shape, undefined, undefined, "exact"));
    const out = collectAbsExports(file, env);
    expect(out.named.a).toBeDefined();
    expect(out.named.a!.shape.k).toBe("prim");
  });

  it("undefAbs is the undefined-value face (exact lit undefined)", () => {
    const u = undefAbs();
    expect(u.conf).toBe("exact");
    expect(u.term).toEqual({ op: "lit", value: undefined });
  });
});
