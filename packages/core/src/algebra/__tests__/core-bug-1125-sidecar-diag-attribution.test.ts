/**
 * Bug 1125 —— 缓存的 sidecar 装载诊断**丢失依赖归属** ⇒ 依赖侧车的坏 import
 * 被记在 **root 侧车**名下（用户去 root 里找不到那个名字 ⇒ 定位错文件）。
 *
 * 根因（packages/core/src/algebra/refine.ts）：
 *   `SidecarLoadDiag` 只存 `{ code, message }`；递归求值（root → dep）**共享**
 *   同一个 diags 数组；发射时 `emitSidecarLoadDiags(diags, fromFile)` 一律用
 *   **root** 的 fromFile 归因 ⇒ 依赖侧车的诊断挂错文件。
 *
 * 修法：缓存记录里保留**来源文件**，发射时按来源文件归因；去重键也纳入来源
 * 文件（同一消息在不同文件 ⇒ 两条独立事实，不得互相吞掉）。
 *
 * 本文件钉住：
 * - 依赖侧车的坏 import ⇒ 诊断归因到**依赖侧车路径**（不是 root）；
 * - root 自己的坏 import ⇒ 归因到 root（零回归）；
 * - 同一消息在两个文件 ⇒ 两条诊断都在（去重键含来源文件）。
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  execNudoModule,
  resetNudoModuleExecCache,
  takeRefineDiags,
  type RefineDiag,
} from "../refine.ts";
import { runWithCollectorScope } from "../collector-scope.ts";
import { makeFiles } from "./nudo-constraints.ts";

beforeEach(() => {
  resetNudoModuleExecCache();
  takeRefineDiags();
});

/** 在一个分析作用域里装载侧车 ⇒ 返回该作用域看到的装载诊断 */
function execInScope(
  src: string,
  fromFile: string,
  files: Record<string, string>,
): RefineDiag[] {
  const { loadModule } = makeFiles(files);
  return runWithCollectorScope(() => {
    try {
      execNudoModule(src, { loadModule, fromFile });
    } catch {
      /* 侧车写坏可能抛错：诊断仍须可见 */
    }
    return takeRefineDiags().filter((d) => d.code === "nudo:interface-load");
  });
}

const ROOT = `import { fn, number } from "@nudojs/core";
import { positive } from "./dep.nudo.js";
export const f = fn({ x: positive }, number());
`;

/** 依赖侧车：import 了一个不存在的 builder ⇒ 装载期报「not an injected builder」 */
const BAD_DEP = `import { number, totallyBogus } from "@nudojs/core";
export const positive = number().gt(0);
`;

describe("Bug 1125: 侧车装载诊断的依赖归属", () => {
  it("依赖侧车的坏 import ⇒ 诊断归因到依赖侧车路径（不是 root）", () => {
    const diags = execInScope(ROOT, "/t/root.nudo.js", { "/t/dep.nudo.js": BAD_DEP });
    const bad = diags.filter((d) => d.message.includes("is not an injected builder"));
    expect(bad.length).toBeGreaterThan(0);
    expect(bad[0]!.file).toBe("/t/dep.nudo.js");
    expect(bad[0]!.file).not.toBe("/t/root.nudo.js");
  });

  it("root 自己的坏 import ⇒ 归因到 root（零回归）", () => {
    const root = `import { fn, number, totallyBogus } from "@nudojs/core";
export const f = fn({ x: number() });
`;
    const diags = execInScope(root, "/t/root2.nudo.js", {});
    const bad = diags.filter((d) => d.message.includes("is not an injected builder"));
    expect(bad.length).toBeGreaterThan(0);
    expect(bad[0]!.file).toBe("/t/root2.nudo.js");
  });

  it("同一消息在 root 与依赖侧车各一处 ⇒ 两条诊断都在（去重键含来源文件）", () => {
    const root = `import { fn, number, totallyBogus } from "@nudojs/core";
import { positive } from "./dep.nudo.js";
export const f = fn({ x: positive }, number());
`;
    const diags = execInScope(root, "/t/root3.nudo.js", { "/t/dep.nudo.js": BAD_DEP });
    const bad = diags.filter((d) => d.message.includes("is not an injected builder"));
    const files = new Set(bad.map((d) => d.file));
    expect(files.has("/t/root3.nudo.js")).toBe(true);
    expect(files.has("/t/dep.nudo.js")).toBe(true);
  });
});
