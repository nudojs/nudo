/**
 * Bug 442：`export default` 函数的侧车契约在**跨文件调用点**完全不执法
 * ⇒ L1 契约假绿（`calc(-1)` 违反 `x > 0`，CI 门禁放行）——而具名导出 /
 * 命名空间导入 / CJS require / 重命名导入四种形态都执法。
 *
 * 根因：`ImportDefaultSpecifier` 把被调名写死成**导出名** `"default"`，
 * 而契约绑定面（interface.ts）以**本地声明名**为键（`exports[fnName]`）⇒
 * 具名侧车永远绑不上。
 *
 * 钉住：跨文件 default 导入的调用点按被调方的**本地声明名**解析 ⇒
 * - `export default function calc` + 侧车 `export const calc = fn(…)` → 执法
 * - `export { calc as default }` + 同侧车 → 执法
 * - 侧车写 `export default fn(…)` → 仍然执法（不回归）
 * - 具名导入（对照）→ 仍然执法
 */
import { describe, it, expect, beforeEach } from "vitest";
import { checkSource, pTrue } from "../index.ts";
import { resetCheckSourceMemo } from "../check.ts";
import { makeFiles } from "./nudo-constraints.ts";

const SIDECAR_NAMED = `import { fn, number } from "@nudojs/core";
export const calc = fn({ x: number().gt(0) }, number());
`;

const SIDECAR_DEFAULT = `import { fn, number } from "@nudojs/core";
export default fn({ x: number().gt(0) }, number());
`;

const SRC_DEFAULT_FN = `export default function calc(x) { return x + 1; }`;
const SRC_EXPORT_LIST = `export function calc(x) { return x + 1; }\nexport { calc as default };`;

const CALLER = `import calc from "./a.js";
export function use() { return calc(-1); }
`;

describe("Bug 442 跨文件 default 导入的契约执法", () => {
  beforeEach(() => {
    resetCheckSourceMemo();
  });

  const checkCaller = (files: Record<string, string>) => {
    const { loadModule } = makeFiles(files);
    return checkSource("/t/b.js", CALLER, pTrue, { loadModule, fromFile: "/t/b.js" });
  };

  it("export default function calc + 具名侧车 ⇒ 调用点报违例", () => {
    const r = checkCaller({ "/t/a.js": SRC_DEFAULT_FN, "/t/a.nudo.js": SIDECAR_NAMED });
    const violated = r.issues.filter((i) => i.code === "nudo:constraint-violated");
    expect(violated.length).toBe(1);
    expect(r.ok).toBe(false);
  });

  it("export { calc as default } + 具名侧车 ⇒ 调用点报违例", () => {
    const r = checkCaller({ "/t/a.js": SRC_EXPORT_LIST, "/t/a.nudo.js": SIDECAR_NAMED });
    const violated = r.issues.filter((i) => i.code === "nudo:constraint-violated");
    expect(violated.length).toBe(1);
    expect(r.ok).toBe(false);
  });

  it("侧车写 export default fn(…) ⇒ 仍然执法（不回归）", () => {
    const r = checkCaller({ "/t/a.js": SRC_DEFAULT_FN, "/t/a.nudo.js": SIDECAR_DEFAULT });
    const violated = r.issues.filter((i) => i.code === "nudo:constraint-violated");
    expect(violated.length).toBe(1);
  });

  it("具名导入（对照）⇒ 仍然执法", () => {
    const { loadModule } = makeFiles({
      "/t/a.js": SRC_DEFAULT_FN,
      "/t/a.nudo.js": SIDECAR_NAMED,
    });
    const src = `import { calc } from "./a.js";\nexport function use() { return calc(-1); }\n`;
    const r = checkSource("/t/c.js", src, pTrue, { loadModule, fromFile: "/t/c.js" });
    expect(r.issues.filter((i) => i.code === "nudo:constraint-violated").length).toBe(1);
  });
});
