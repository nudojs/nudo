/**
 * 族 30 · S0（串行前置 · 只抽不改）—— **check 装配面**：
 * `checkSource` 的调用装配 + check issue → vite `Diagnostic` 的转换。
 *
 * ## S0 的共享契约（**冻结** —— S1 / S2 / S3 / S4 只能消费，不许改签名）
 *
 * 1. **模块职责边界**：本模块只管「**check 面怎么被装配、check issue 怎么变成
 *    `Diagnostic`**」。
 *    - `checkSource` 的调用装配（`loadModule` / `autoBind` / `skips` / `modules` /
 *      `inject` / `entryThrows` / `ignoreThrows` —— **S2 已补齐后两项**）。
 *    - check issue → 中间态（**位置与 code 原样带出**，**不自己拼文本** ——
 *      文本拼装只有一个出口，在 `report.ts` 的 `renderDiagnostic`）。
 *    - **不**含：分析范围判定（`scope.ts`）、诊断上报 / 渲染 / 汇总（`report.ts`）。
 *    - ⚠ **会话缓存的失效接线（写给 S2 / S4）**：`(id, source)` 恒等命中的
 *      `checkOutcomeCache` **在 `index.ts`（S4 拥有）**。S2 若要在 898 / 983 的
 *      Abs 模块图求值上复用同一套缓存，**只能**在**本模块内**再加一层
 *      `(id, source)` 缓存，**并由 S4 在 `buildStart` / `watchChange` 里调用
 *      本模块的清理入口** —— 否则跨构建 / 跨 watch 轮次会命中陈旧结果
 *      （缓存的生命周期必须与 `index.ts` 的 `checkOutcomeCache` 同寿）。
 *      ⇒ **S4 的接线义务（条件性）**：**若** S2 在本模块内新增了缓存层，
 *      `buildStart` / `watchChange` 必须同时清掉它。
 *      ✅ **S2 的结论（2026-10-23）**：898 / 983 的 Abs 模块图求值**已经**在
 *      `buildViteCheckInjection` 内、且**已经**被 `index.ts` 的
 *      `checkOutcomeCache`（`(id, source)` 恒等命中）覆盖 ⇒ **S2 不新增
 *      任何缓存层 ⇒ S4 无需新增清理接线**（既有 `buildStart` / `watchChange`
 *      的 `checkOutcomeCache.clear()` 已足够）。
 * 2. **导出函数签名**（显式 ctx 对象，不许散参数）：
 *    - `assembleCheckOutcome(id: string, code: string): CheckProjection`
 *      （**只读**既有类型 `CheckProjection`；S0 = 原 `checkIssuesToDiagnostics` 的
 *      逐字搬家，只改了名字以对齐契约）。
 *    - 类型 `CheckProjection = { diagnostics: Diagnostic[]; failure?: string }`。
 *    - 内部件 `buildViteCheckInjection(id, code): RunTranspiledOptions`
 *      （**模块私有**；S2 若需外部消费可在**本模块内**导出，不许外泄到 `index.ts`）。
 * 3. **零新增公共导出**：本模块只被 `./index.ts` **相对 import**，
 *    **一律不许**从 `index.ts` re-export ⇒ 打包面（`tsup src/index.ts`）零变化。
 * 4. **`configResolved` 惰性落点**：与本模块无关（落在 `scope.ts`）。
 * 5. **守卫与早退落点**：`assembleCheckOutcome` 内部的 `try/catch` 是
 *    **check 管线自身崩溃**的唯一收口（崩溃 → `failure` 字符串 ⇒ 宿主按
 *    `failOnError` 档 warn / error）；与 `scope.ts` 的三处早退**互不重叠**。
 * 6. **行为等价证据**：改前（HEAD 只读副本）/ 改后（工作树）用同一批夹具
 *    （`tmp/probe/fix-r80/fx/**`）跑 `transform` 逐字对拍 —— 见
 *    `tmp/probe/fix-r92/s0/before.txt` / `after.txt`（`diff` 为空）。
 *
 * ## S2 的落地（族 30 · Bug 897 / 898 / 983）—— **只改体，不改签名**
 *
 * - **897（真修）**：`assembleCheckOutcome` 从**同一份项目配置**
 *   （`findProjectConfig(dirname(id))?.config`）取 L2 档位
 *   （`entryThrows` / `ignoreThrows`）并传给 `checkSource`。此前**不传**
 *   ⇒ `checkSource` 用默认最严档（`entryThrows:"error"` /
 *   `ignoreThrows:[]`）⇒ 项目配置的 `nudo.check.*` 被无视（插件自己却读了
 *   同源配置的 `autoBind`）。
 *   ⚠ **勘误（BUG-110）**：LSP **不再**走 service 的 `checkConfig` ——
 *   `validation.ts` / `agent-tools.ts` 的 `ignoreThrows` 走
 *   `lsp/src/gate-config.ts` 的 `configIgnoreThrows`（裸字符串 / 数组内逗号
 *   都认），而 `checkConfig` 的严格 `string[]` 过滤会静默丢成空表。故本层
 *   只把 `entryThrows` 交给 `checkConfig`，`ignoreThrows` 走同语义的
 *   `parseIgnoreThrows`（见其注释）⇒ 插件面才真正与 CLI / IDE 判同。
 * - **898 / 983（**已被族 18 的 `buildViteCheckInjection` 闭合**）**：
 *   Abs 模块图（`evalAbsModuleGraph`）早就在 `buildViteCheckInjection` 里
 *   求值，并以 `modules` + `inject` **同时**传给 `checkSource`
 *   （core 的 `evalAnalyzeOpts` 取 `opts.modules ?? inject.modules`）
 *   ⇒ 跨模块返回契约可证（不再报 `nudo:unproven-return`）、
 *   真违例回到 **error** 级 `nudo:constraint-violated`（`failOnError` 会拦）。
 *   ⇒ S2 **不改**实现，只补**回归钉**
 *   （`__tests__/vite-bug-898-*.test.ts` / `vite-bug-983-*.test.ts`），
 *   并在报告里记录「勘察基线已陈旧」的勘误。
 *
 * ## Bug 1089 —— 无 `line` 的 check issue 不得被伪造成 `:1:0`
 *
 * core 产出的部分 check issue **不带源位置**（`nudo:module-unreadable`
 * 「依赖模块存在但不可读」/ `nudo:internal` …）⇒ 本层此前把 `undefined`
 * 兜底成第 1 行第 0 列 ⇒ 构建日志把「**另一个文件**不可读」定位到**当前
 * 文件第 1 行**（误导定位，也与 CLI 人类面「无位置就不打位置」分裂）。
 *
 * ⇒ **不编造位置**：无 `line` 时用 service 的占位约定 `{line: 0, column: 0}`
 * ⇒ `report.ts` 的 `renderLocation`（`line <= 0` ⇒ 省略 `:line:col`）统一
 * 省略位置 ⇒ 与 CLI 人类面（`core/src/algebra/check-report.ts`：
 * `i.line != null ? \`L${i.line}\` : ""`）同口径。
 */
import {
  defaultLoadModule as loadModule,
  findProjectConfig,
  interfaceConfig,
  checkConfig,
  collectSkipReturns,
  collectEnvNames,
  collectEnvGlobals,
  collectEnvModules,
  collectEvalReplacements,
  evalAbsModuleGraph,
  applyMockModuleDirectivesFromSource,
  mergeHarvestUnderEnv,
  mockSeedsForSource,
  type Diagnostic,
} from "@nudojs/service";
import { dirname, resolve as resolvePath } from "node:path";
import {
  checkSource,
  pTrue,
  type Abs,
  type AbsModuleExports,
  type RunTranspiledOptions,
} from "@nudojs/core";

/**
 * checkSource 面结果：`diagnostics` = 契约门禁诊断（L1 actual ⊭ expected /
 * L2 entry-may-throw，与 evaluator 诊断同管道进 vite warn/error）；
 * `failure` = check 管线自身崩溃（装配/注入失败）。二者互斥：崩溃时不
 * 产出诊断，由宿主按 failOnError 档 warn / error（BUG-023：注入/装配
 * 失败必须可见，不得吞成空诊断让 `nudo check` 红、`vite build` 绿）。
 */
export type CheckProjection = { diagnostics: Diagnostic[]; failure?: string };

/**
 * check 面的**注入装配**（Bug 634）。
 *
 * CLI（`packages/nudojs/src/commands/check.ts` 的 `buildCheckInjection`）
 * 与 LSP（`packages/lsp/src/agent-tools.ts` 的 `buildLspInjection`）都把
 * `@nudo:mock` / `@nudo:as` / `@nudo:replace` / env 全局装进 core 的
 * `inject` 通道再交给 `checkSource`；本插件此前**只传** `loadModule` /
 * `autoBind` / `skips` ⇒ 注入**整段缺席** ⇒ 被 mock 掉的依赖退化成未知
 * 全局 ⇒ 构建期报 `nudo:entry-may-throw`（假红），而同一份文件
 * `nudo check` 判绿（CI 绿 / 构建红）。
 *
 * 口径与 CLI / LSP 同源（env 名单、模块图、mock-module 覆盖、mock 表、
 * 行内指令表逐项同款）；**刻意**的差异：CLI 额外并入
 * `@nudo:mock name from "path"` 的装载失败旁路诊断（`mockFromErrors`），
 * 本插件的 check 面不并入那条（构建期的加载失败由分析器通道
 * `analyzeFileAsync` 的 diagnostics 负责）。
 *
 * 装配失败（语法错文件 / 模块图不可用）**降级为空注入**——不把构建打挂
 * （诊断面仍由 `checkSource` 自己的报错通道出）。
 */
function buildViteCheckInjection(id: string, code: string): RunTranspiledOptions {
  const inject: RunTranspiledOptions = {};
  // env 名单：文件级 `@nudo:env` ∪ 项目级 `package.json#nudo.env`。
  //
  // **项目级说明符先按项目根绝对化**（BUG-221）：service 的 env 解析基准是
  // **进程级单槽**（`env-loader` 的 `lastEnvBaseDir` = **最后一次** preload 的
  // 目录），而 preload 顺序是「项目级 → 文件级」⇒ 被检文件里只要有一行
  // **文件级** `@nudo:env`，基准就落在**文件目录** ⇒ 项目级相对说明符
  // `"./env/web.ts"` 被解析成 `<fileDir>/env/web.ts` ⇒ 项目级全局丢失
  // ⇒ 门禁面报 `never` / `ReferenceError`，而**同一文件**的 evaluator 面仍是
  // `99`（env 预载走绝对化后的名单）⇒ 同一个插件的两个面互相打脸。
  // 口径与 CLI `assembleEnvs`（`packages/nudojs/src/commands/check.ts`：
  // 项目级先按项目根绝对化、文件级按文件目录）逐项一致。
  let envNames: string[] = [];
  let envGlobals: Record<string, Abs> = {};
  let envMods: Record<string, AbsModuleExports> = {};
  try {
    const fileEnvBaseDir = dirname(id);
    const proj = findProjectConfig(fileEnvBaseDir);
    const projectEnvBaseDir = proj?.projectDir ?? fileEnvBaseDir;
    const rawProjectEnv = proj?.config.env;
    const projectEnvNames = (Array.isArray(rawProjectEnv) ? rawProjectEnv : []).filter(
      (n): n is string => typeof n === "string",
    );
    const projectEnvSpec = projectEnvNames.map((name) =>
      name.startsWith("./") || name.startsWith("../")
        ? resolvePath(projectEnvBaseDir, name)
        : name,
    );
    envNames = [...new Set([...projectEnvSpec, ...collectEnvNames(id, code, false)])];
    envGlobals = collectEnvGlobals(envNames);
    envMods = collectEnvModules(envNames);
  } catch {
    envNames = [];
    envGlobals = {};
    envMods = {};
  }
  // 模块图（跨模块 import/require）+ env 模块并入 + `@nudo:mock-module` 覆盖
  let modules: Record<string, AbsModuleExports> = {};
  try {
    const graph = evalAbsModuleGraph(code, id);
    // env 模块（fs/path/node:*…）并入模块图：**必须走 `mergeHarvestUnderEnv`**
    // （与 CLI / test / service 面同口径）——手工 env 与 harvest **同名模块**时，
    // env 赢同名槽、harvest 填 env 的**空位**（B8）。
    // 旧实现用对象展开（`{...graph.modules, ...envMods}`）⇒ 同名模块下 harvest 的
    // **非冲突导出被整体丢弃** ⇒ 插件面绑定缺失 ⇒ 误报 `nudo:unknown-inference`，
    // 而 CLI 面同文件无诊断、签名精确（Bug 1037 / BUG-111）。
    modules = mergeHarvestUnderEnv(graph.modules, envMods);
    modules = applyMockModuleDirectivesFromSource(code, modules, {
      fromFile: id,
    }).modules;
  } catch {
    modules = {};
  }
  // `@nudo:mock`：函数级 mock 覆盖表（语法错文件 ⇒ 空表，不打挂构建）
  let mocks: Record<string, never> = {};
  try {
    mocks = mockSeedsForSource(code, { fromFile: id }) as Record<string, never>;
  } catch {
    mocks = {};
  }
  // 行内指令：`@nudo:replace` / `@nudo:as` 的覆盖表
  let reps: ReturnType<typeof collectEvalReplacements> = {
    targets: [],
    values: {},
    asTargets: [],
    asValues: {},
  };
  try {
    reps = collectEvalReplacements(code);
  } catch {
    reps = { targets: [], values: {}, asTargets: [], asValues: {} };
  }
  return {
    ...(Object.keys(modules).length > 0 ? { modules } : {}),
    ...(Object.keys(mocks).length > 0 ? { mocks: mocks as never } : {}),
    ...(Object.keys(envGlobals).length > 0 ? { envGlobals } : {}),
    ...(reps.targets.length > 0
      ? { replacements: reps.values, replacementTargets: reps.targets }
      : {}),
    ...(reps.asTargets.length > 0
      ? { asOverrides: reps.asValues, asOverrideTargets: reps.asTargets }
      : {}),
  };
}

/**
 * `package.json#nudo.check.ignoreThrows` 的**配置面解析**（BUG-110）。
 *
 * 语义真源 = CLI 的 `parseIgnoreThrows`
 * （`packages/nudojs/src/check-gate-config.ts`）；LSP 的
 * `packages/lsp/src/gate-config.ts` 是它的同语义镜像。service 的
 * `checkConfig` 只认**严格 `string[]`**（`Array.isArray` + 逐项
 * `typeof === "string"`）⇒ 裸字符串 `"TypeError"` 被**静默丢成空表**、
 * `["TypeError,RangeError"]` 不被切分（永远匹配不上任何 throw 类）
 * ⇒ 插件面该 throw 类照报（构建红），而 CLI / IDE 认这两种写法（绿）
 * ⇒ **同一份 `package.json` 三面三口径**，`failOnError: true` 时直接中断构建。
 *
 * 本插件此前是唯一还走 `checkConfig` 严格解析的面（LSP 早已改成自己的
 * 宽松解析器）⇒ 这里是那第三份**同语义**实现，改动时三处必须同步。
 *
 * 语义：裸字符串 / 字符串数组都接受；数组元素内部**也**按逗号切分；
 * trim 后丢空串；非字符串元素忽略；全空 ⇒ 空表（=「没设」）。
 */
function parseIgnoreThrows(raw: unknown): string[] {
  if (raw === undefined || raw === null) return [];
  const parts = Array.isArray(raw) ? raw : [raw];
  return parts
    .flatMap((s) => (typeof s === "string" ? s.split(",") : []))
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** Abs check issues → service Diagnostic（与 evaluator 诊断同管道进 vite warn/error） */
export function assembleCheckOutcome(id: string, code: string): CheckProjection {
  try {
    // 与 CLI/LSP/agent 同源：package.json#nudo.contract.autoBind=false 时
    // 不得强制 ambient 手写契约（避免构建期误报）。
    //
    // **同一次**读项目配置 ⇒ `autoBind` 与 L2 门禁档位（`entryThrows` /
    // `ignoreThrows`）取自**同一份** `package.json#nudo`（Bug 897：此前
    // 插件只读了 `autoBind`，L2 档位恒为 `checkSource` 的默认最严档
    // ⇒ 项目配置的 `nudo.check.*` 被无视 ⇒ 同一个仓库 `nudo check` 绿、
    // `vite build` 红，`failOnError: true` 时直接中断构建）。
    const projConfig = findProjectConfig(dirname(id))?.config;
    const autoBind = interfaceConfig(projConfig).autoBind;
    // L2 门禁档位：`entryThrows` 走 service 的 `checkConfig`（三面同源）；
    // `ignoreThrows` **不走它**——`checkConfig` 的严格 `string[]` 过滤会把
    // 裸字符串 / 逗号写法静默丢成空表 ⇒ 插件面与 CLI / IDE 判不同
    // （BUG-110，见 `parseIgnoreThrows` 的注释）。CLI 的旗标层覆盖不在
    // 插件面（插件没有 CLI 旗标）。
    const gate = checkConfig(projConfig);
    const ignoreThrows = parseIgnoreThrows(
      (projConfig?.check as { ignoreThrows?: unknown } | undefined)?.ignoreThrows,
    );
    const inject = buildViteCheckInjection(id, code);
    const report = checkSource(id, code, pTrue, {
      loadModule,
      fromFile: id,
      ...(autoBind === false ? { autoBind: false } : {}),
      // Bug 897：L2 档位必须随配置传下去 —— 不传 ⇒ `checkSource` 用默认
      // `entryThrows:"error"` / `ignoreThrows:[]`（最严档）。
      entryThrows: gate.entryThrows,
      ...(ignoreThrows.length > 0 ? { ignoreThrows } : {}),
      skips: collectSkipReturns(code),
      // 与 CLI `checkSource(..., { modules: inject.modules, inject })` 同形：
      // `modules` 必须是**并入 env / mock-module 覆盖后**的表（core 的
      // `evalAnalyzeOpts` 取 `opts.modules ?? inject.modules`）。
      ...(Object.keys(inject).length > 0
        ? { modules: inject.modules as never, inject }
        : {}),
    });
    return {
      diagnostics: report.issues
        // info **不**在此处砍掉（Bug 779）：噪声档取舍归
        // `filterDiagnosticsByLevel`（`verbose` 才放行 info；`default`/
        // `errors`/`off` 各自过滤）。先砍 info ⇒ 档位过滤器永远看不到 info
        // ⇒ `nudo.analysis.diagnostics: "verbose"` 对 check 诊断是**空操作**，
        // 且 `nudo:assume-relied` / `nudo:invariant-relied` /
        // `nudo:opaque-result` 在构建日志里永不上屏（与 LSP 面同款分裂）。
        .map((i) => {
          const parts = [i.message];
          if (i.actual) parts.push(`actual: ${i.actual}`);
          if (i.expected) parts.push(`expected: ${i.expected}`);
          if (i.suggestion) parts.push(i.suggestion);
          if (i.code) parts.push(`(${i.code})`);
          // Bug 1089：**无源位置**的 check issue（依赖模块存在但不可读
          // `nudo:module-unreadable` / `nudo:internal` …）**不带 `line`** ⇒
          // 此前被兜底成第 1 行第 0 列 ⇒ 构建日志把「另一个文件不可读」这类
          // 诊断定位到**当前文件第 1 行**（既误导定位，又与 CLI 人类面
          // 「无位置就不打位置」和本包 `report.ts` 的 `renderLocation` 契约
          // 三面不一致）。
          //
          // ⇒ **不编造**位置：无 `line` 时用 service 的占位约定
          // `{line: 0, column: 0}` ⇒ `renderLocation`（`line <= 0` ⇒
          // 省略 `:line:col`）统一省略位置（与 CLI 同口径）。
          const hasLine = typeof i.line === "number" && i.line > 0;
          const line = hasLine ? i.line! : 0;
          const column = hasLine && typeof i.column === "number" ? i.column : 0;
          return {
            // severity 三档原样带出（error / warning / info）——档位由
            // `filterDiagnosticsByLevel` 统一裁决，转换层不预判。
            severity: i.severity,
            message: parts.join(" · "),
            code: i.code,
            range: {
              start: { line, column },
              end: { line, column: hasLine ? column + 1 : 0 },
            },
          };
        }),
    };
  } catch (err) {
    // 不静默：崩溃以 failure 上抛给宿主（默认 this.warn，failOnError 时
    // this.error），且不进 viteDiagnosticsLevel 过滤——管线故障不是源码
    // 诊断，diagnostics 档位（off/errors/…）无权把它抹掉。
    return {
      diagnostics: [],
      failure: `check failed for ${id}: ${(err as Error).message}`,
    };
  }
}
