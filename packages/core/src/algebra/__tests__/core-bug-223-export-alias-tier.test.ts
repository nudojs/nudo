/**
 * BUG-223：LSP `semanticTokens` 把「导出别名」（`export const alias = target;`）
 * 判成 **函数 + 契约档(derived)**，而 `documentSymbol` 判 Variable、
 * CodeLens / hover 判**不在契约档** ⇒ 同一绑定三面互斥。
 *
 * 根因在 core 的**单一读取口** `interfaceTierOf`（`interface.ts`，A7：CodeLens
 * / hover / inlay / semantic tokens 共用，保证「同源」）：`implicit` 回落只看
 * `localNamedExports` ⇒ 任何本地具名导出都拿到 implicit 档 ⇒ derived 修饰。
 *
 * 钉：无契约的**导出别名 / 变量导出**不进档（undefined）；真正的函数位才有
 * implicit 档；有契约的函数位仍是 handwritten。
 */
import { describe, it, expect, beforeEach } from "vitest";
import { interfaceTierOf, takeInterfaceDiags, resetSidecarLoadFailureCache } from "../interface.ts";
import { takeRefineDiags } from "../refine.ts";
import { makeFiles } from "./nudo-constraints.ts";

const SRC = `export function target() {
  return 1;
}

export const alias = target;
export const notAFn = 1;
`;

const SIDECAR = `import { fn, number } from "@nudojs/core";

export const target = fn({}, number());
`;

function tier(name: string, source = SRC) {
  const { loadModule } = makeFiles({ "/t/a.nudo.js": SIDECAR });
  return interfaceTierOf(source, name, "/t/a.js", { loadModule, fromFile: "/t/a.js" });
}

describe("BUG-223 interface 档单一读取口不为导出别名伪造派生档", () => {
  beforeEach(() => {
    resetSidecarLoadFailureCache();
    takeInterfaceDiags();
    takeRefineDiags();
  });

  it("导出别名（无契约）⇒ 不进 interface 档（旧口径给 implicit ⇒ derived）", () => {
    expect(tier("alias")).toBeUndefined();
  });

  it("变量导出（无契约）⇒ 不进 interface 档", () => {
    expect(tier("notAFn")).toBeUndefined();
  });

  it("真正的函数位（无契约）⇒ implicit 档（既有行为不变）", () => {
    const source = `export function bare() {\n  return 1;\n}\n`;
    const t = tier("bare", source);
    expect(t?.source).toBe("implicit");
  });

  it("有契约的函数位 ⇒ handwritten（与 CodeLens 同源）", () => {
    expect(tier("target")?.source).toBe("handwritten");
  });
});
