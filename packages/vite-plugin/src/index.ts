import {
  analyzeFileAsync,
  clearAnalysisSessionCaches,
  type AnalysisResult,
} from "@nudojs/service";
import type { Plugin, ResolvedConfig } from "vite";
import {
  configureScope,
  normalizeModuleId,
  scopeDecision,
  setProjectRoot,
} from "./scope.ts";
import { assembleCheckOutcome, type CheckProjection } from "./check-assembly.ts";
import {
  emitDiagnostics,
  envUnresolvedDiagnostics,
  logAnalysisSummary,
  mergeDiagnostics,
  renderAnalysisFailure,
  renderCheckFailure,
  type ReportContext,
} from "./report.ts";

export type NudoPluginOptions = {
  include?: string[] | string;
  exclude?: string[] | string;
  /**
   * error 级诊断是否让构建失败。
   * 默认 false（E3 / docs）：构建期诊断先 warn，避免无指令/隐式推断误伤 CI。
   * 契约门禁请用 `nudo check`（CI gate）或显式 `failOnError: true`。
   * 项目可用 `nudo.analysis.diagnostics` 控制噪声档；显式契约 error 仍会打出。
   */
  failOnError?: boolean;
};

/**
 * 族 30 · S0（串行前置 · 只抽不改）—— **薄壳**：只剩插件对象 + 三个缓存表 +
 * 钩子编排。三个内部模块（**不从这里 re-export** ⇒ 公共导出面零变化）：
 *
 * - `./scope.ts` —— 模块 id 归一化 / 分析范围判定（include / exclude 匹配 +
 *   `shouldAnalyzeFile` 守卫的调用点 / `config.root` 的记录）。
 * - `./check-assembly.ts` —— `checkSource` 的调用装配 + check issue → `Diagnostic`。
 * - `./report.ts` —— 诊断上报循环 / `failOnError` 聚合 / `buildEnd` 汇总 /
 *   输出通道选择 / 消息装配的唯一出口（`renderDiagnostic`）。
 *
 * 公共导出面**一字未改**：`export default nudoPlugin` + `export type NudoPluginOptions`。
 *
 * ## 族 30 · S4（895 / 900）—— 本文件的独占改动
 *
 * 1. **插件对象加 `enforce: "pre"`**（Bug 895 / 900）：本插件排在核心插件
 *    `vite:esbuild` **之前** ⇒ `transform` 收到**原始 TS 源码**（含类型
 *    注解）⇒ `.ts` 源里只存在于注释的 `@nudo:` 指令**可见** ⇒
 *    895（假红）与 900（静默放绿）同根因闭合。诊断行号随之回到**源码坐标系**。
 * 2. **模块 id 归一化接线**（S1 的 C-S1-1）：`transform` 里分析与诊断一律用
 *    `normalizeModuleId(id)`（`scope.ts` 已导出，签名冻结）⇒ 诊断文本不再带
 *    `?t=`；`sidecarPathOf` 命中真实侧车 ⇒ HMR 期侧车契约不再静默失效。
 * 3. **`scopeDecision` 调用移进 `try`**（S1 的 C-S1-2）：守卫异常不得冒泡出
 *    钩子（构建不炸）。
 */
export default function nudoPlugin(options: NudoPluginOptions = {}): Plugin {
  // include / exclude 匹配器编译一次（模块级持有，见 scope.ts）。
  configureScope(options);
  // failOnError 默认 false（E3 有意保留）：构建期诊断先 warn；契约 CI 门禁
  // 走 `nudo check`。要让 error 阻断构建请显式 failOnError: true。
  const failOnError = options.failOnError ?? false;

  // buildEnd 汇总统计用（诊断计数）；分析复用走 service 会话缓存，不读本表
  const analysisCache = new Map<string, AnalysisResult>();

  // checkSource 面的会话缓存：check 诊断无法从 analyzeFileAsync 的
  // AnalysisResult 投影（其 diagnostics 是 evaluator 面，不含 L1
  // constraint-violated / L2 entry-may-throw 门禁 issue），checkSource 链
  // 必须保留；本缓存按 (id, source 内容) 恒等命中，消除同一 build 会话内
  // 对未变文件的重复 check 推断（如 client/SSR 双环境各 transform 一遍）。
  // 失效与 analysisCache 同生命周期：任一文件变更（watchChange）或全新
  // 构建（buildStart）即整表丢弃——check 诊断是 (id, code, 磁盘侧车/依赖)
  // 的纯函数，磁盘变化必然先过 watchChange。
  // ⚠ **S4 的接线义务**：`check-assembly.ts` 若新增自己的 `(id, source)` 缓存
  // （S2 的 898 / 983 性能兜底），`buildStart` / `watchChange` 必须**一并清掉**
  // 它（否则跨构建陈旧命中）—— 见 check-assembly.ts 的契约头注。
  const checkOutcomeCache = new Map<string, { source: string; outcome: CheckProjection }>();

  // path-env 加载失败去重表（同 baseDir 多文件构建只报一次；buildStart /
  // watchChange 随其它缓存整表丢弃——新一轮构建必须重新上报）。
  const envErrorSeen = new Set<string>();

  return {
    name: "vite-plugin-nudo",

    /**
     * **族 30 · S4 · Bug 895 / 900** —— 排在核心插件 `vite:esbuild` **之前**。
     *
     * 没有 `enforce: "pre"` 时本插件排在 normal 档 ⇒ `transform` 收到的是
     * **esbuild 的转译产物**（TS loader 剥光注释）⇒ `.ts` 源里**只存在于
     * 注释**的 `@nudo:` 指令全部不可见：
     * - **895（假红面）**：`@nudo:throws` 之类的声明看不见 ⇒ 分析按「无指令
     *   普通模块」跑 ⇒ 报出 `nudo check` **不会**报的 error（构建假红）。
     * - **900（假绿面）**：`@nudo:contract` / `@nudo:case` 看不见 ⇒ 门禁
     *   **静默放绿**（同一份契约的 `.js` 源报红、`.ts` 源零诊断）。
     *
     * ⚠ **副作用（已处理）**：`enforce: "pre"` ⇒ 本插件看到**原始 TS 源码**
     * （含类型注解）⇒ 分析面必须吃得住 TS 语法。两道兜底：
     * ① **S1 的 902 守卫**（`scope.ts` 的 `scopeDecision`：前置
     *    `typeof code !== "string"` + `shouldAnalyzeFile` 调用包在 `try` 里）
     *    ⇒ 范围判定永不抛；
     * ② 本 `transform` 的兜底 `catch` ⇒ 分析面**解析失败**（装饰器等 TS
     *    特有语法）降级为一条 `Failed to analyze` warning ⇒ **绝不炸构建**。
     *
     * ⚠ **诊断行号随之从「转译产物坐标系」回到「源码坐标系」** —— 这是
     * **预期修复**（诊断集合不变，位置回到用户写代码的那份文件）。
     */
    enforce: "pre",

    /**
     * 记录项目根（`config.root`）——**惰性**：S0 阶段无人读它 ⇒ 行为零变化；
     * S1 起 scope 匹配才真正消费它（见 scope.ts 的 setProjectRoot）。
     */
    configResolved(config: ResolvedConfig) {
      setProjectRoot(config.root);
    },

    buildStart() {
      analysisCache.clear();
      checkOutcomeCache.clear();
      envErrorSeen.clear();
      // 全新构建：丢掉上一轮会话 memo，避免跨 build 陈旧命中
      clearAnalysisSessionCaches();
    },

    /** 任一文件变更后，未改 source 的 importer 再 transform 时可能命中陈旧会话缓存 */
    watchChange() {
      analysisCache.clear();
      checkOutcomeCache.clear();
      envErrorSeen.clear();
      clearAnalysisSessionCaches();
    },

    async transform(code: string, id: string) {
      // 同步重入本插件实例的 scope（模块级状态；第一个 await 之前 ⇒ 无交错）。
      // 与重构前「每个插件实例各持一份 matcher」等价。
      configureScope(options);
      // 分析 / 诊断用的模块 id（剥 `?t=` / `?v=` query，见下）。
      let fileId = id;
      let fatal: string[] = [];
      try {
        // A1/A2：与 LSP 同门禁——analysis.mode=directives|exports|all，
        // 不再用硬编码 @nudo 正则挡掉无指令文件。
        // 三处早退（虚拟模块跳过 / include-exclude 失配 / shouldAnalyzeFile
        // 守卫）全部落在 scope.ts 的 scopeDecision（见 scope.ts 的契约）。
        // ⚠ **守卫调用在 try 内**（S1 的 C-S1-2）：`scopeDecision` 契约上
        // 永不抛，但异常一旦冒泡也必须被插件兜底 `catch` 接住 —— 构建不炸。
        const decision = scopeDecision(id, code);
        if (decision.skip) return null;

        // **模块 id 归一化**（剥 `?t=` / `?v=` query）—— 分析与诊断一律用
        // 归一化后的 id（S1 的 C-S1-1）：
        // ① 诊断文本不再带 `?t=`；
        // ② `sidecarPathOf(fromFile)` 命中**真实侧车** ⇒ HMR 期侧车契约
        //    不再静默失效（此前 `/p/a.js?t=1` ⇒ 侧车路径 `/p/a.js?t=1.nudo.js`
        //    必读不到 ⇒ 契约缺席 ⇒ 门禁假绿）。
        fileId = normalizeModuleId(id);
        // async 以便 path 型 @nudo:env 预加载（与 LSP analyzeFileAsync 对齐）
        const result = await analyzeFileAsync(fileId, code, undefined, undefined, undefined, "none");
        let check = checkOutcomeCache.get(fileId);
        if (!check || check.source !== code) {
          check = { source: code, outcome: assembleCheckOutcome(fileId, code) };
          checkOutcomeCache.set(fileId, check);
        }
        const checkDiags = check.outcome.diagnostics;
        // path env 加载失败（@nudo:env ./missing.js）必须可见：此前 vite-plugin
        // 从不读 getPathEnvLoadErrors ⇒ env 静默不生效且零诊断（Bug 474）。
        const envDiags = envUnresolvedDiagnostics(fileId, code, envErrorSeen);
        const merged = mergeDiagnostics({
          id: fileId,
          result,
          checkDiagnostics: checkDiags,
          envDiagnostics: envDiags,
        });
        analysisCache.set(fileId, merged);

        // 上报上下文（vite 插件上下文 → report.ts 的显式 ctx）。
        const ctx: ReportContext = {
          id: fileId,
          failOnError,
          warn: (m) => this.warn(m),
          error: (m) => this.error(m),
          info:
            typeof this.info === "function" ? (m) => this.info(m) : undefined,
        };
        // error 级诊断在 failOnError 档下**只收集**（不立即抛）——先收集，
        // try 外再抛：this.error 会 throw，不能被 catch 吞。
        fatal = emitDiagnostics(ctx, merged.diagnostics);
        // check 管线崩溃：默认 warn（不静默、不 fail 构建）；failOnError
        // 时收集到 fatal 走 this.error（与源诊断同一档位语义）
        if (check.outcome.failure) {
          const crashMsg = renderCheckFailure(check.outcome.failure);
          if (failOnError) {
            // 已有 error 级诊断时崩溃消息被丢弃（与重构前 `fatal ?? crashMsg` 一致）。
            if (fatal.length === 0) fatal = [crashMsg];
          } else {
            this.warn(crashMsg);
          }
        }
      } catch (err) {
        this.warn(renderAnalysisFailure(fileId, (err as Error).message));
      }
      // try 外抛：Rollup/Vite 的 this.error 会 throw，不能被上面的 catch 吞掉
      if (fatal.length > 0) this.error(fatal[0]);

      return null;
    },

    buildEnd() {
      const totalDiags = Array.from(analysisCache.values())
        .reduce((sum, r) => sum + r.diagnostics.length, 0);
      if (totalDiags > 0) {
        const errorCount = Array.from(analysisCache.values())
          .reduce((sum, r) => sum + r.diagnostics.filter((d) => d.severity === "error").length, 0);
        // warning 计数只算 warning（info 级走 vite info 通道，不是告警——
        // 摘要行格式 `[nudo] Analysis complete: X error(s), Y warning(s)`
        // 已被文档承诺，info 不得计入 Y）。
        const warnCount = Array.from(analysisCache.values())
          .reduce((sum, r) => sum + r.diagnostics.filter((d) => d.severity === "warning").length, 0);
        const ctx: ReportContext = {
          id: "",
          failOnError,
          warn: (m) => this.warn(m),
          error: (m) => this.error(m),
          info: typeof this.info === "function" ? (m) => this.info(m) : undefined,
        };
        logAnalysisSummary(ctx, errorCount, warnCount);
      }
    },
  };
}
