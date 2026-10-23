/**
 * Bug 1031：类声明**之前**出现一条 `export { … };` 说明符语句 ⇒ 该类的实例
 * 方法 / 静态方法签名静默塌成 `unknown` ⇒ ① 签名面给出错值；② 追加一条**误导**
 * 诊断 `nudo:opaque-result`（提示「加 @nudo:case 或调用点」，真相是引擎内部
 * 异常）；③ **最重**：类方法的返回类型契约违规从 **error 降级成 warning** ⇒
 * `nudo check` exit 0 放行 ⇒ **假绿**；④ **顺序敏感**（同一份代码把
 * `export { q };` 挪到类之后 ⇒ 全部恢复正常）。
 *
 * 根因（generalize.ts 的 `ctorParamCountOf`）：遍历到 `ExportNamedDeclaration`
 * 且 `declaration === null`（说明符语句，不是声明语句）时解引用 `decl.type`
 * ⇒ 空指针 TypeError ⇒ 被 `runCore` 的空 `catch {}` 吞掉 ⇒ fail-closed
 * unknown。修复：显式跳过 null；并把「桥内部异常」与「B run 本身失败」区分
 * （前者记进 eval-fallback 统计，不再静默）。
 *
 * 钉：
 * - 三形态（`export { q }` 在类**前** / 在类**后** / 无）签名**逐字相同**
 *   （顺序无关 = 不再顺序敏感）。
 * - 契约面：类方法返回类型契约被违反时必须是 **error**（不是 warning）。
 * - 负控制：`export const q = 1`（声明语句）形态不受影响。
 */
import { describe, it, expect } from "vitest";
import { checkSource, pTrue } from "../index.ts";
import { generalizeFromAst } from "../generalize.ts";
import { formatShape } from "../format.ts";
import { makeFiles } from "./nudo-constraints.ts";

/** `export { q };` 在类**前**（说明符语句） */
const PRE = `const q = 1;
export { q };
export class Cls1031pre { m() { return 1; } }
`;
/** `export { q };` 在类**后** */
const POST = `const q = 1;
export class Cls1031post { m() { return 1; } }
export { q };
`;
/** 无 export 列表 */
const NONE = `const q = 1;
export class Cls1031none { m() { return 1; } }
`;
/** 负控制：`export const q = 1` 是**声明语句**（declaration 非 null） */
const DECL = `export const q = 1;
export class Cls1031decl { m() { return 1; } }
`;

describe("Bug 1031：类声明前的 export 说明符语句不再让类方法签名塌 unknown", () => {
  it("三形态（说明符语句在类前 / 类后 / 无）的符号面逐字相同", () => {
    const shapes = [PRE, POST, NONE].map((src) => {
      const cls = /class (\w+)/.exec(src)?.[1] ?? "";
      const g = generalizeFromAst(`${cls}.m`, src);
      expect(g, `generalizeFromAst 失败：${cls}`).toBeDefined();
      return formatShape(g!.symbolic);
    });
    // 修复前：pre 形态是 unknown，另两个是 1（顺序敏感）
    expect(shapes).toEqual(["1", "1", "1"]);
  });

  it("pre 形态（说明符语句在类前）的类方法签名不是 unknown", () => {
    const cls = "Cls1031pre";
    const g = generalizeFromAst(`${cls}.m`, PRE);
    expect(g).toBeDefined();
    expect(formatShape(g!.symbolic)).toBe("1");
    expect(g!.display).toBe(`${cls}.m: () => 1`);
  });

  it("负控制：`export const q = 1`（声明语句）形态不受影响", () => {
    const cls = "Cls1031decl";
    const g = generalizeFromAst(`${cls}.m`, DECL);
    expect(g).toBeDefined();
    expect(formatShape(g!.symbolic)).toBe("1");
  });

  it("check 面：三形态的签名显示逐字相同（不是 unknown）", () => {
    const sigs = [PRE, POST, NONE].map((src, i) => {
      const file = `/t/b1031-${i}.js`;
      const r = checkSource(file, src, pTrue, { fromFile: file });
      const sig = r.signatures.find((s) => s.name.endsWith(".m"));
      return sig ?? null;
    });
    // 修复前：pre 形态是 unknown，另两个是 1（顺序敏感）
    // ⚠ `display` 自 Bug 413 起是人类面口径的 shape 渲染（不再带 `#conf` 段）
    expect(sigs.map((s) => s?.display)).toEqual(["1", "1", "1"]);
    expect(sigs.map((s) => s?.conf)).toEqual(["exact", "exact", "exact"]);
  });

  it("契约面：类方法返回类型契约违规必须是 error（不是 warning）", () => {
    // 侧车契约：Cls1031viol_m 的返回类型是 number，实测返回 string ⇒ 违规
    const src = `const q = 1;
export { q };
export class Cls1031viol { m(x) { return "not a number"; } }
`;
    const file = "/t/b1031-viol.js";
    const { loadModule } = makeFiles({
      "/t/b1031-viol.nudo.js": `export const Cls1031viol_m = fn({ x: number() }, number());\n`,
    });
    const r = checkSource(file, src, pTrue, { loadModule, fromFile: file });
    const violated = r.issues.filter((i) => i.code === "nudo:constraint-violated");
    expect(violated).toHaveLength(1);
    expect(violated[0]!.severity).toBe("error");
    // 修复前：签名塌 unknown ⇒ 违规降级成 warning 级 nudo:unproven-return
    const downgraded = r.issues.filter((i) => i.code === "nudo:unproven-return");
    expect(downgraded).toEqual([]);
  });
});
