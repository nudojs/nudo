/**
 * BUG-194 —— 分支块内给**宿主全局**赋值 ⇒ fork 快照对宿主真全局发射
 * `$copy(<宿主对象>)` ⇒ `$copy` 裸读 `a.shape.k` ⇒ 引擎抛裸 TypeError
 * ⇒ `run.ts` 归为 `nudo:internal` ⇒ 合法代码门禁假红（宿主上完全正常）。
 *
 * 修复：`$copy` 与 `$get` / `$set` 的 DEC-006 口径对齐——非 Abs（宿主值）
 * fail-closed **原值返回**（调用点 `x = $copy(x)` 重绑为自赋值 no-op），
 * 禁止读 `.shape` 炸宿主。
 */
import { describe, it, expect } from "vitest";
import { $copy } from "../exec/runtime/containers/obj.ts";
import { runTranspiled, callTranspiledExportFull } from "../exec/run.ts";
import { litValue } from "../abs.ts";

describe("BUG-194 — fork 快照不得对宿主全局抛裸 TypeError", () => {
  it("$copy 对非 Abs 宿主值原值返回（不读 .shape）", () => {
    const host = globalThis as unknown;
    expect(() => $copy(host as never)).not.toThrow();
    expect($copy(host as never)).toBe(host);
    expect(() => $copy(undefined as never)).not.toThrow();
  });

  it("分支块内写宿主全局可求值（不产生内部异常），且不污染宿主全局", () => {
    const src = `if (true) { globalThis.__nudo_bug194_probe = 1; }
export function f() { return 1; }`;
    const exports = runTranspiled(src, { mode: "analyze" });
    const rec = callTranspiledExportFull(exports, "f", []);
    expect(litValue(rec.result)).toEqual({ ok: true, value: 1 });
    // fail-closed：引擎不真的写宿主全局
    expect((globalThis as Record<string, unknown>).__nudo_bug194_probe).toBeUndefined();
  });

  it("顶层形态（对照组）同样不崩 —— 两种写法结论一致", () => {
    const src = `globalThis.__nudo_bug194_probe2 = 1;
export function f() { return 1; }`;
    const exports = runTranspiled(src, { mode: "analyze" });
    expect(litValue(callTranspiledExportFull(exports, "f", []).result)).toEqual({
      ok: true,
      value: 1,
    });
  });
});
