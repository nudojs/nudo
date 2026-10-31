/**
 * eval 注入包装配的**单一实现**（全产品面共享：CLI check / migrate /
 * health、LSP agent 工具、vite-plugin）。
 *
 * 历史：此前五份平行装配（nudojs `commands/shared.ts` 的
 * `buildEvalInjection`、`commands/health.ts` 的 `buildHealthInjection`、
 * lsp `agent-tools.ts` 的 `buildLspInjection`、vite-plugin
 * `check-assembly.ts` 的 `buildViteCheckInjection`）各自手写同构体，漂移
 * 事故全部来自漏改其中一份：
 * - Bug 1037 / Bug 226：对象展开 `{...graph.modules, ...envMods}` 合并 env
 *   模块 ⇒ 同名模块下 harvest 的非冲突导出被整体丢弃（必须走
 *   `mergeHarvestUnderEnv`）——health 面是最后一份漏改的；
 * - Bug 228：env 名分层解析（项目级按项目根 / 文件级按文件目录）；
 * - `mockFromErrors` 丢弃（health 面曾不收集上报）。
 *
 * 装配内容：模块图（`evalAbsModuleGraph`）+ env modules
 * （`mergeHarvestUnderEnv`）+ `@nudo:mock-module` 覆盖 + `@nudo:mock`
 * seeds + env 全局 + `@nudo:as` / `@nudo:replace` 替换。
 *
 * 消费方只在**解析策略**上分叉（`parseAst` 参数）：
 * - CLI check 注入 `parseForCheck`（按扩展名严格解析，Bug 633：`.js` 里的
 *   TS-only 语法在此**抛错** ⇒ 走语法错通道，不静默判绿）；
 * - migrate verify 注入 parser 的宽松 `parse`（verify 的 TS-only 拦截在
 *   自己的严格解析步骤里，Bug 114，不在装配点）；
 * - LSP / vite-plugin 注入宽松 `parse`。
 *
 * 装配失败 throw——由调用方降级处理（BUG-023：分析仍跑，但门禁红且缓存
 * 不回写）。
 *
 * `dirDiags`：D1 指令文法诊断显式落袋（调用方创建/持有）。三个发射源
 * 同袋——
 *  - collectEvalReplacements：行内 @nudo:as/@nudo:replace（语句级独立去重）
 *  - extractDirectives：函数级 case/mock/skip/sample
 *  - mockDirectivesToAbsSeeds 对 @nudo:mock 类型值表达式的 parseCaseArgExpr
 *    复解析（与 extract 共域去重：同文案在 extract 已报则不再双报）
 */
import {
  extractDirectives,
  extractFileDirectives,
  parse,
  runWithDirectiveDiags,
  type DirectiveDiag,
} from "@nudojs/parser";
import type { RunTranspiledOptions } from "@nudojs/core";
import { evalAbsModuleGraph } from "./abs-modules-graph.ts";
import { collectEvalReplacements } from "./eval-injection.ts";
import {
  collectEnvGlobals,
  collectEnvModules,
  mergeHarvestUnderEnv,
} from "./eval-run.ts";
import { mockDirectivesToAbsSeeds, mockSeedsToAbsMocks } from "./mock-abs.ts";
import { applyMockModuleDirectivesFromSource } from "./mock-module.ts";
import type { MockFromError } from "./check-issues.ts";

export type { MockFromError };

export function buildEvalInjection(
  filePath: string,
  source: string,
  allEnvNames: string[],
  dirDiags: DirectiveDiag[],
  parseAst: (filePath: string, source: string) => ReturnType<typeof parse>,
): { inject: RunTranspiledOptions; mockFromErrors: MockFromError[] } {
  const graph = evalAbsModuleGraph(source, filePath);
  const reps = collectEvalReplacements(source, { diags: dirDiags });
  const seedPkg = runWithDirectiveDiags(dirDiags, () => {
    const ast = parseAst(filePath, source);
    const seeds = mockDirectivesToAbsSeeds(extractDirectives(ast), {
      fromFile: filePath,
    });
    // D1 同族：JSDoc 块内错位的文件级指令族标签（@nudo:env / @nudo:mock-module）
    // 不再静默——纯查询 extract 落本域（提取面不变，仍只认行注释）
    extractFileDirectives(ast);
    return seeds;
  });
  let mockFromErrors: MockFromError[] = seedPkg.fromErrors ?? [];
  const mocks = mockSeedsToAbsMocks(seedPkg);
  const envGlobals = collectEnvGlobals(allEnvNames);
  const envMods = collectEnvModules(allEnvNames);
  // env modules（fs/path/node:*…）并入模块图：**必须走 mergeHarvestUnderEnv**
  // （check / verify / test / service 面同口径）——手工 env 与 harvest
  // **同名模块**时，env 赢同名槽、harvest 填 env 的**空位**（B8）。
  // 旧实现用对象展开（`{...graph.modules, ...envMods}`）⇒ 同名模块下
  // harvest 的**非冲突导出被整体丢弃** ⇒ check/verify 面报 `unknown` +
  // 误导性 `nudo:unknown-inference`，而 test 面报**精确值** ⇒ 两个产品面
  // 互相矛盾（Bug 1037；verify 面同族 Bug 226）。
  let mergedMods = mergeHarvestUnderEnv(graph.modules, envMods);
  // @nudo:mock-module：覆盖 import 说明符导出（全量/局部）
  const mm = applyMockModuleDirectivesFromSource(source, mergedMods, {
    fromFile: filePath,
  });
  mergedMods = mm.modules;
  mockFromErrors = [
    ...mockFromErrors,
    ...mm.errors.map((e) => ({
      name: e.name,
      fromPath: e.fromPath,
      message: e.message,
      ...(e.code !== undefined ? { code: e.code } : {}),
    })),
  ];
  const inject: RunTranspiledOptions = {
    // Bug 456：**不再**因为「检出环」就丢弃整张依赖图。旧实现在检出 cycle
    // 时把 modules 降级成「只有 env 模块」⇒ 环内文件的 import 全部落空 ⇒
    // 环内函数在 check 面恒为 unknown（原生是确定值）。
    // 引擎侧已能正确处理环（core exec/run.ts 调用入口刷新 live import
    // 绑定 + live-imports.ts 弱引用注册表），环内求值**有界**：
    // - 装载层：模块图检出环即返回「环内已部分求值的导出 / 空导出」
    //   （abs-modules-graph.ts evalDep 的 cycle 分支），不递归装载；
    // - 求值层：调用/分支预算是硬闸（call-budget.ts），递归必被截断成
    //   `nudo:recursion-truncated`（info），不会无限求值。
    // ⇒ 无需「整图丢弃」这种有损降级；环本身仍由诊断面（`nudo:module-cycle`
    // warning）报告，不靠丢图来「避免」环。
    ...(Object.keys(mergedMods).length > 0 ? { modules: mergedMods } : {}),
    ...(Object.keys(mocks).length > 0 ? { mocks } : {}),
    ...(Object.keys(envGlobals).length > 0 ? { envGlobals } : {}),
    ...(reps.targets.length > 0
      ? { replacements: reps.values, replacementTargets: reps.targets }
      : {}),
    ...(reps.asTargets.length > 0
      ? { asOverrides: reps.asValues, asOverrideTargets: reps.asTargets }
      : {}),
  };
  return { inject, mockFromErrors };
}
