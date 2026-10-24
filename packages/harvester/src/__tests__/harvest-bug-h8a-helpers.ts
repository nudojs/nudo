/**
 * H8a 的**共享**回归 helper（草稿面的**类型语义**）。
 *
 * 纪律（与 H8b 的共享 helper 同源）：
 * - 工作目录建在**仓库内的 `tmp/`**（gitignored）——侧车里
 *   `import … from "@nudojs/core"` 才能沿目录树解析到仓库的 node_modules；
 * - 产品 CLI 走 **src**（`node --import tsx packages/nudojs/src/index.ts`），
 *   不依赖 `dist/`；
 * - 通用工具（工作目录 / 侧车落盘 / 产品 CLI）复用 H8b 的共享 helper；
 *   本文件只加**草稿面类型语义**特有的两件：草稿 ⇒ 侧车契约装载
 *   （core 的侧车装载器 = 产品面的真实装载路径）、契约的**域隶属**判定
 *   （`literalMeetsConstraint` ⇒ 「这个值落不落在契约域内」）。
 */
import { execNudoModule, derefConstraint, type NudoConstraint } from "@nudojs/core";

export {
  makeWorkDir,
  removeWorkDir,
  runNudoCheck,
  writeSidecar,
  repoRoot,
} from "./harvest-bug-h8b-helpers.ts";

/** fn 约束的展开形态（core 的 `NudoFnConstraint`） */
export type FnConstraint = NudoConstraint & {
  fn?: {
    params: Record<string, NudoConstraint>;
    returns?: NudoConstraint;
    throws?: NudoConstraint;
  };
};

/**
 * 草稿源码 ⇒ 侧车导出表（按**导出名**索引）。
 *
 * 走 core 的**侧车装载器**（`execNudoModule`）⇒ 与产品面
 * （`nudo check` 读 `*.nudo.js`）**同一条装载路径**：草稿里的
 * `import { … } from "@nudojs/core"` 会被换成注入的构建器表。
 * 返回**原始**导出值（不 deref）⇒ 测试能断言「这个导出**是不是**约束」。
 */
export function loadDraftExports(draftSource: string): Record<string, unknown> {
  return execNudoModule(draftSource);
}

/** 侧车导出 ⇒ 约束（fn 约束带 `fn` 槽） */
export function asConstraint(raw: unknown): FnConstraint {
  return derefConstraint(raw as never) as FnConstraint;
}

/** fn 约束的**返回位**约束 */
export function fnReturns(c: FnConstraint): NudoConstraint {
  const r = c.fn?.returns;
  if (!r) throw new Error("fn constraint has no returns slot");
  return r;
}

/** fn 约束的**形参位**约束 */
export function fnParam(c: FnConstraint, name: string): NudoConstraint {
  const p = c.fn?.params?.[name];
  if (!p) throw new Error(`fn constraint has no param '${name}'`);
  return p;
}
