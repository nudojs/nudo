/**
 * 族 30 · S0（串行前置 · 只抽不改）—— **scope 面**：模块 id 归一化 +
 * 分析范围判定（include / exclude 匹配 + `shouldAnalyzeFile` 守卫）。
 *
 * ## S0 的共享契约（**冻结** —— S1 / S2 / S3 / S4 只能消费，不许改签名）
 *
 * 1. **模块职责边界**：本模块只管「**这个模块 id 要不要分析**」。
 *    - `DEFAULT_INCLUDE` / `DEFAULT_EXCLUDE`：默认分析目标表（原 `index.ts` 同名常量）。
 *    - id 归一化（剥 `?t=` / `?v=` query）、虚拟模块判定。
 *    - include / exclude 匹配器（**编译一次**，模块级持有）。
 *    - `shouldAnalyzeFile` 守卫的**调用点**（S1 在此加 `typeof code` 前置 + 移进 `try`）。
 *    - 项目根（`config.root`）的**记录**（S0 惰性记录，**此时无人读它** ⇒ 行为零变化；
 *      S1 才让它真正参与匹配）。
 *    - **不**含：诊断装配（`check-assembly.ts`）、诊断上报 / 渲染（`report.ts`）。
 * 2. **导出函数签名**（显式 ctx 对象，不许散参数）：
 *    - `configureScope(options: ScopeOptions): void` —— 编译并持有 include / exclude 匹配器。
 *    - `scopeDecision(id: string, code: string): ScopeDecision` —— **三处早退的唯一落点**
 *      （exclude 失配 / include 失配 / `shouldAnalyzeFile` 守卫）。
 *    - `normalizeModuleId(id: string): string` —— 剥 query（虚拟模块的判定见 `isVirtualModuleId`）。
 *    - `isVirtualModuleId(id: string): boolean` —— `\0` 前缀 / `virtual:` 前缀。
 *    - `setProjectRoot(root: string | undefined): void` —— 记录 `config.root`。
 *    - `getProjectRoot(): string | undefined` —— 读取项目根（S1 起被真正消费）。
 * 3. **零新增公共导出**：本模块只被 `./index.ts` **相对 import**，
 *    **一律不许**从 `index.ts` re-export ⇒ 打包面（`tsup src/index.ts`）零变化。
 * 4. **`configResolved` 惰性落点**：`index.ts` 的插件对象上加 `configResolved(config)`
 *    钩子，**只**调用 `setProjectRoot(config.root)` —— S0 阶段无人读它 ⇒ 行为零变化。
 * 5. **守卫与早退落点**：`transform` 入口的三处早退全部落在 `scopeDecision`
 *    （S0 只搬不改：虚拟模块跳过 = Bug 896 / 剥 query = Bug 903 ⇒ **S1 已接线**）。
 * 6. **行为等价证据**：改前（HEAD 只读副本）/ 改后（工作树）用同一批夹具
 *    （`tmp/probe/fix-r80/fx/**`）跑 `transform` 逐字对拍 —— 见
 *    `tmp/probe/fix-r92/s0/before.txt` / `after.txt`（`diff` 为空）。
 *
 * ## S1 的落点（896 / 902 / 903 / 1018 / 1056）——**签名一律不变**
 *
 * `scopeDecision` 内部改成一条**归一化流水线**（顺序固定，见下）：
 *
 * ```
 * 原始 id（如 "/p/src/a.js?t=123" / "\0virtual:mod2.js"）
 *   │
 *   ├─(1) 虚拟模块判定  isVirtualModuleId(id)          → skip "virtual"   【896】
 *   ├─(2) 入参守卫      typeof code !== "string"        → skip "guard"     【902】
 *   ├─(3) 剥 query      normalizeModuleId(id) → abs     【903】
 *   ├─(4) 依赖图视角    dependencyView(abs) → view      【1056】
 *   ├─(5) 项目相对化    projectRelative(abs) → rel      【1018】
 *   ├─(6) 双口径匹配    exclude(view‖rel) → include(view‖rel)
 *   └─(7) 分析守卫      shouldAnalyzeFile(abs, code) 包在 try 里  【902】
 * ```
 *
 * - **(4) 依赖图视角（1056）**：Vite 对**软链依赖**给的 id 是 **realpath**
 *   （`node_modules/dep → ../dep-pkg` ⇒ id = `<root>/dep-pkg/index.js`）⇒
 *   「node_modules 段」那条默认排除规则匹配不上 ⇒ 别的包源码被当项目源码分析。
 *   本模块把 id 归一化成**依赖图视角**：
 *   - `view` = 依赖图里那条路径（`<root>/node_modules/dep/index.js`）⇒
 *     默认排除表对它**照常命中**；
 *   - `isDependency` = 「id / realpath 含 `node_modules` 段」∨
 *     「realpath 落在某个 `node_modules` 软链的解析目标下」∨
 *     「realpath 落在工程根之外」⇒ 依赖**一律排除**（假红 + 跨面矛盾一并消掉）。
 * - **(5)+(6) 双口径（1018）**：插件选项的 include / exclude 现在同时对
 *   **绝对路径**与**相对 `config.root` 的路径**求值 ⇒ 与
 *   `packages/service/src/analysis-scope.ts` 的 `excludeHit` / `includeHit`
 *   **同口径**（同名同语法的 `nudo.analysis.include/exclude` 与插件选项判定一致）。
 *
 * ⚠ **跨片协调点（S1 → S4）**：`index.ts` 的 `transform` 仍把**原始 id**
 * （带 `?t=` query）传给 `analyzeFileAsync` / `assembleCheckOutcome`
 * ⇒ 诊断文本带 query、且 `sidecarPathOf("/p/a.js?t=1")` = `/p/a.js?t=1.nudo.js`
 * ⇒ **侧车契约在 HMR 期找不到**。修法在 S4：`transform` 里改用
 * `normalizeModuleId(id)`（本模块已导出，签名冻结）作为分析与诊断的 id。
 */
import { lstatSync, readdirSync, realpathSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { compileAnyMatcher, shouldAnalyzeFile } from "@nudojs/service";

/**
 * 与 isNudoTargetPath 对齐：分析目标仅为 `.js` / `.mjs` / `.ts`。
 * `.cjs` / `.cts` / `.mts` / `.d.ts` / `.tsx` 不是分析目标（exclude
 * 已挡 `.d.ts` 与 `node_modules`；`*.nudo.js` 由 shouldAnalyzeFile 拒绝）。
 */
export const DEFAULT_INCLUDE = ["**/*.js", "**/*.mjs", "**/*.ts"];
export const DEFAULT_EXCLUDE = ["**/node_modules/**", "**/*.d.ts"];

/** 插件选项的 scope 面（与 `NudoPluginOptions` 的 include / exclude 同源）。 */
export type ScopeOptions = {
  include?: string[] | string;
  exclude?: string[] | string;
};

/**
 * 分析范围判定结果。
 * - `skip: true` ⇒ `transform` 早退（不分析、不产出诊断）。
 * - `reason`：`"exclude"` / `"include"` / `"guard"`（早退原因）/ `"analyze"`（放行）
 *   / `"virtual"`（虚拟模块 —— Bug 896）。
 */
export type ScopeDecision = { skip: boolean; reason: string };

type Matcher = (id: string) => boolean;

/** include / exclude 匹配器（模块级；由 `configureScope` 编译一次后持有）。 */
let includeMatch: Matcher = compileAnyMatcher(DEFAULT_INCLUDE);
let excludeMatch: Matcher = compileAnyMatcher(DEFAULT_EXCLUDE);

/**
 * 编译结果缓存（key = 选项指纹）——`configureScope` 因此可以在
 * **`transform` 入口**（每次）安全重入而不重复编译正则。
 * ⚠ 模块级状态 ⇒ 同时活着的两个插件实例会共享它；`transform` 入口在
 * **第一个 await 之前**同步重入 `configureScope(options)` ⇒ 每个插件实例
 * 看到的始终是**自己的**匹配器（与重构前「每实例一份 matcher」等价）。
 */
const compiledCache = new Map<string, { include: Matcher; exclude: Matcher }>();

/** 项目根（`config.root`）—— S0 只记录，S1 起参与匹配。 */
let projectRoot: string | undefined = undefined;

/**
 * 编译并持有 include / exclude 匹配器。
 * 由 `nudoPlugin(options)` 在**插件构造时**调用，并在 `transform` 入口
 * （第一个 await 之前，同步）重入 ⇒ 热路径零编译成本。
 */
export function configureScope(options: ScopeOptions): void {
  const key = JSON.stringify([options.include ?? null, options.exclude ?? null]);
  let compiled = compiledCache.get(key);
  if (!compiled) {
    compiled = {
      include: compileAnyMatcher(options.include ?? DEFAULT_INCLUDE),
      exclude: compileAnyMatcher(options.exclude ?? DEFAULT_EXCLUDE),
    };
    compiledCache.set(key, compiled);
  }
  includeMatch = compiled.include;
  excludeMatch = compiled.exclude;
}

/** 记录项目根（`config.root`）。 */
export function setProjectRoot(root: string | undefined): void {
  projectRoot = root;
}

/** 读取项目根（`config.root`）。 */
export function getProjectRoot(): string | undefined {
  return projectRoot;
}

/**
 * 模块 id 归一化：**剥掉 query**（`?t=<timestamp>` / `?v=<hash>` / …）。
 * S1 起 `scopeDecision` 在**匹配与分析之前**统一走这一步（Bug 903）。
 */
export function normalizeModuleId(id: string): string {
  const q = id.indexOf("?");
  return q < 0 ? id : id.slice(0, q);
}

/**
 * 虚拟模块 id 判定：Vite 的虚拟模块 id 带 `\0` 前缀或 `virtual:` 前缀
 * （含 `\0virtual:…`）。S1 起 `scopeDecision` 在**第一步**就跳过它们
 * （Bug 896：虚拟 id 拼出的侧车路径含 NUL ⇒ 必读不到 ⇒ 干净模块被判 error）。
 */
export function isVirtualModuleId(id: string): boolean {
  return id.startsWith("\0") || id.startsWith("virtual:");
}

// ---------------------------------------------------------------------------
// S1：依赖图视角（1056）+ 双口径匹配（1018）
// ---------------------------------------------------------------------------

/** 工程根的绝对形态（`config.root` 已是绝对路径；此处只做兜底规范化）。 */
function projectRootAbs(): string | undefined {
  if (projectRoot === undefined) return undefined;
  return resolve(projectRoot);
}

/** `p` 是否在 `root` 之内（含 root 自身）。 */
function isInside(root: string, p: string): boolean {
  return p === root || p.startsWith(root.endsWith(sep) ? root : `${root}${sep}`);
}

/**
 * 项目相对路径（**1018 的相对口径**）。
 * 与 `packages/service/src/analysis-scope.ts` 的 `excludeHit` / `includeHit`
 * 同守卫：逃出工程根（`..` 前缀）⇒ **不参与**相对口径。
 */
function projectRelative(absPath: string): string | undefined {
  const root = projectRootAbs();
  if (!root) return undefined;
  const rel = relative(root, absPath).split(sep).join("/");
  if (rel === "" || rel.startsWith("..")) return undefined;
  return rel;
}

/** 路径是否含 `node_modules` **段**（不是子串 —— `my-node_modules` 不算）。 */
function hasNodeModulesSegment(p: string): boolean {
  return p.split(/[\\/]+/).includes("node_modules");
}

/** realpath（读不到就退回原路径 —— 文件不存在 / 无权限都不该炸构建）。 */
function realPathOf(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
}

/** node_modules 目录下的一个软链条目（`link` = 软链本身，`target` = 解析目标）。 */
type NodeModulesLink = { link: string; target: string };

/**
 * `node_modules` 目录 → 其下**软链**条目的解析目标（按目录缓存，一次构建只扫一遍）。
 * 只收软链：物理目录形态由「路径含 `node_modules` 段」那条规则兜住。
 */
const nodeModulesLinkCache = new Map<string, NodeModulesLink[]>();

function readdirSafe(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

function nodeModulesLinks(nmDir: string): NodeModulesLink[] {
  const cached = nodeModulesLinkCache.get(nmDir);
  if (cached) return cached;
  const links: NodeModulesLink[] = [];
  for (const entry of readdirSafe(nmDir)) {
    // `.bin` / `.pnpm` / `.cache` 等内部目录不是包入口（`.pnpm` 里的路径
    // 本来就含 `node_modules` 段，由另一条规则兜住）。
    if (entry.startsWith(".")) continue;
    const full = join(nmDir, entry);
    // scoped 包（`@scope/pkg`）的软链在第二层。
    const candidates = entry.startsWith("@")
      ? readdirSafe(full).map((sub) => join(full, sub))
      : [full];
    for (const candidate of candidates) {
      try {
        if (lstatSync(candidate).isSymbolicLink()) {
          links.push({ link: candidate, target: realpathSync(candidate) });
        }
      } catch {
        // 读不到 ⇒ 当它不是软链（不炸构建）。
      }
    }
  }
  nodeModulesLinkCache.set(nmDir, links);
  return links;
}

/**
 * 候选 `node_modules` 目录：**工程根向上链**（`<root>/node_modules`、
 * `<repo>/node_modules`、… —— monorepo / pnpm 工作区的软链都在这里）。
 */
function candidateNodeModulesDirs(): string[] {
  const dirs = new Set<string>();
  const root = projectRootAbs();
  if (root) {
    let dir = root;
    for (;;) {
      dirs.add(join(dir, "node_modules"));
      const up = dirname(dir);
      if (up === dir) break;
      dir = up;
    }
  }
  return [...dirs];
}

/**
 * 依赖图视角的路径形态。
 * - `abs`：剥 query 后的绝对路径。
 * - `view`：**依赖图里那条路径** —— 软链依赖被还原成
 *   `<root>/node_modules/dep/index.js` ⇒ 默认的 node_modules 排除规则
 *   对它照常命中（1056）。
 * - `isDependency`：是不是「别的包的源码」⇒ 一律排除。
 */
type ScopePath = { abs: string; view: string; isDependency: boolean };

function scopePath(absPath: string): ScopePath {
  const realPath = realPathOf(absPath);
  // 物理目录形态：id 或 realpath 含 `node_modules` 段。
  if (hasNodeModulesSegment(absPath) || hasNodeModulesSegment(realPath)) {
    return { abs: absPath, view: absPath, isDependency: true };
  }
  // 软链依赖形态：realpath 落在某个 `node_modules` 软链的解析目标下
  // ⇒ 还原成依赖图视角的路径。
  for (const nmDir of candidateNodeModulesDirs()) {
    for (const link of nodeModulesLinks(nmDir)) {
      if (realPath === link.target || realPath.startsWith(`${link.target}${sep}`)) {
        const view = join(link.link, relative(link.target, realPath));
        return { abs: absPath, view, isDependency: true };
      }
    }
  }
  // 工程根之外 ⇒ 不是本工程的源码（依赖 / 别处的工作区包）。
  const root = projectRootAbs();
  const outsideRoot = root !== undefined && !isInside(root, realPath);
  return { abs: absPath, view: absPath, isDependency: outsideRoot };
}

/**
 * 双口径匹配（**1018**）：绝对路径口径 **或** 项目相对口径命中即算命中
 * —— 与 `analysis-scope.ts` 的 `excludeHit` / `includeHit` 同口径。
 */
function matchDual(matcher: Matcher, view: string, rel: string | undefined): boolean {
  if (matcher(view)) return true;
  return rel !== undefined && matcher(rel);
}

/**
 * 分析范围判定（**`transform` 入口三处早退的唯一落点**）。
 *
 * S1 = 归一化流水线（顺序见文件头）：
 *   1. 虚拟模块（Bug 896）⇒ 跳过；
 *   2. 入参畸形（Bug 902）⇒ 跳过；
 *   3. 剥 query（Bug 903）⇒ 匹配与分析同一基准；
 *   4. 依赖图视角（Bug 1056）⇒ 依赖一律排除；
 *   5. 双口径匹配（Bug 1018）⇒ exclude 优先于 include；
 *   6. `shouldAnalyzeFile` 守卫（Bug 902）—— **包在 try 里**：守卫抛错时
 *      降级为「跳过」，绝不把异常冒泡出钩子。
 */
export function scopeDecision(id: string, code: string): ScopeDecision {
  // (1) 虚拟模块：`\0` 前缀 / `virtual:` 前缀 —— 无真实文件、无同目录侧车。
  if (typeof id !== "string") return { skip: true, reason: "guard" };
  if (isVirtualModuleId(id)) return { skip: true, reason: "virtual" };
  // (2) 入参守卫：`shouldAnalyzeFile` 的守卫只挡 `undefined`，`null` 会崩
  //     （`hasNudoDirectives(null)` ⇒ `Cannot read properties of null`）。
  if (typeof code !== "string") return { skip: true, reason: "guard" };
  // (3) 剥 query（`?t=<ts>` / `?v=<hash>`）。
  const abs = normalizeModuleId(id);
  // (4) 依赖图视角（软链依赖 / 工程根之外 ⇒ 排除）。
  const path = scopePath(abs);
  if (path.isDependency) return { skip: true, reason: "exclude" };
  // (5) 双口径匹配：绝对路径 + 项目相对路径。
  const rel = projectRelative(path.abs);
  if (matchDual(excludeMatch, path.view, rel)) return { skip: true, reason: "exclude" };
  if (!matchDual(includeMatch, path.view, rel)) return { skip: true, reason: "include" };
  // (6) 分析守卫 —— **包在 try 里**（异常不得冒泡出钩子）。
  try {
    if (!shouldAnalyzeFile(abs, code)) return { skip: true, reason: "guard" };
  } catch {
    return { skip: true, reason: "guard" };
  }
  return { skip: false, reason: "analyze" };
}
