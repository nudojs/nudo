/**
 * loadModule 可达依赖的内容指纹（check 整文件 memo + generalize L0 共用）。
 * 覆盖 @nudo:import / ESM from / require / dynamic import；对每条 spec 做
 * 传递 BFS（seen 防环），直到节点上限。截断时 truncated=true——调用方必须
 * fail-open（不得写入/读取 memo）。
 *
 * 内容口径 = `stableAnalyzeKeySource`（分析稳定投影，与入口自身的缓存键同源）：
 * 尾部无 `@nudo` 的注释/空白编辑不翻转指纹（ABS-18）；`@nudo` 指令与真实
 * 代码 / 行号变化照旧翻转。
 */
import { extractNudoImports } from "../refine.ts";
import {
  extractFileEnvNames,
  extractMockModuleRecords,
} from "../directive-scan.ts";
import { hashSource } from "./hash-source.ts";
import { stableAnalyzeKeySource } from "./stable-source-key.ts";
import { parseSource } from "../parse-source.ts";
import { normPath, resolveDepPath, sidecarPathOf, stablePathKey, stablePathKeyGraph } from "../contract/sidecar-path.ts";

// 单一定义在 sidecar-path.ts（leaf）；此处 re-export 维持公共导出面稳定
export { normPath, resolveDepPath, stablePathKey, stablePathKeyGraph };

export type LoadDepsFingerprint = {
  fp: string;
  paths: string[];
  /**
   * path + loadModule-resolved content（miss → null）。调用方（磁盘缓存键）
   * 必须优先用这里的 content，不得回读磁盘——否则 buffer-aware loadModule
   * 与磁盘不一致时键会分叉。
   *
   * **ABS-18**：content 是**分析稳定**投影（`stableAnalyzeKeySource`：去掉
   * 尾部无 `@nudo` 的注释/空白），与 `fp` 同源；`@nudo` 指令、真实代码与
   * 行号变化照旧翻转。只用于键，不用于求值。
   */
  contents: Array<{ path: string; content: string | null }>;
  /** BFS 撞到节点上限：剩余 dep 未进指纹，键不可信 */
  truncated: boolean;
  /**
   * 任一装载 throw（EACCES/EMFILE/…）≠ 真 miss：读错误轮的报告（含
   * nudo:contract-load）与真 miss 轮（干净）内容不同，折叠成同一 miss 键
   * 会互为跨次陈旧命中（#135）。fp 带 `readerr:` 前缀，调用方 fail-open 禁 memo。
   */
  readError: boolean;
};

/**
 * ABS-18：watch **轮内**的依赖指纹 memo（默认关闭）。
 *
 * watch 的增量/全量轮是「顺序分析、轮内不写盘」（`--fix` 与 `--watch` 互斥），
 * 同一轮里 `analyzeFile` 与注入复用键会对同一个入口各算一次依赖指纹——每次都是
 * 一次磁盘 BFS（实测 14–25ms/文件）。开一个轮内 memo 把同一 (入口, loader,
 * 稳定源码) 的指纹只算一次，轮末丢弃。
 *
 * 纪律：
 * - **默认不开启**（`undefined`）⇒ 一次性 CLI / LSP / 所有既有调用方逐字节不变；
 * - 只有宿主显式 `beginDepFingerprintEpoch()` / `endDepFingerprintEpoch()` 期间生效；
 *   轮内写盘（如将来出现）必须由宿主先 end 再 begin；
 * - 只缓存 `opts === undefined` 的调用：带 `ambientAllowed` / `ambientLoadModule`
 *   的指纹由闭包语义决定（checkSource 的推测性 sidecar 探测），不能按文件身份共享；
 * - 返回对象按**只读**使用（`contents` / `paths` 数组不得原地修改）。
 */
let depFpEpoch: Map<string, LoadDepsFingerprint> | null = null;
const depFpLoaderIds = new WeakMap<object, number>();
let depFpLoaderSeq = 0;

function depFpLoaderId(fn: (spec: string, fromFile: string) => string | undefined): number {
  let id = depFpLoaderIds.get(fn);
  if (id === undefined) {
    id = ++depFpLoaderSeq;
    depFpLoaderIds.set(fn, id);
  }
  return id;
}

/** 开启轮内依赖指纹 memo（watch 宿主在每轮开始前调用）。 */
export function beginDepFingerprintEpoch(): void {
  depFpEpoch = new Map();
}

/** 关闭并丢弃轮内 memo（watch 宿主在每轮结束后调用；异常路径也必须调）。 */
export function endDepFingerprintEpoch(): void {
  depFpEpoch = null;
}

/** 防病态图；seen 已防环，此上限只限制遍历量 */
const MAX_LOAD_DEP_NODES = 64;

/**
 * 指纹的 ambient 侧车探测口径（Bug 1124）。
 *
 * ambient 侧车探测是**推测性**的：它只为算指纹，不代表分析真的要用这份侧车
 * （autoBind 关 / 树外 / node_modules ⇒ 根本不会被绑定）。⇒ 探测失败
 * **不得**升级成分析错误（门禁假红），但仍须让本轮指纹**不可信**
 * （readError ⇒ 键带 readerr: 前缀、调用方 fail-open 禁 memo ⇒ 错误轮与
 * miss 轮不共用键、互不为陈旧命中）。
 */
export type LoadDepsFingerprintOpts = {
  /**
   * ambient 侧车探测专用 loader（**推测性**读）。
   * 调用方（check.ts）传**未经降级闸**的 loader：读失败只标 readError，
   * 不记入分析错误。缺省 = 用 `loadModule`（旧行为）。
   */
  ambientLoadModule?: (spec: string, fromFile: string) => string | undefined;
  /**
   * ambient 绑定资格（autoBind / projectDir / node_modules）。
   * 返回 false ⇒ 该侧车不会被 ambient 绑定 ⇒ 探测无意义 ⇒ 跳过
   * （不读盘、不进指纹）。缺省 = 允许（旧行为：过近似，只过度失效）。
   */
  ambientAllowed?: (sidecarPath: string) => boolean;
};

/**
 * AST 节点最小形状（只取说明符抽取要用的字段）。
 */
type SpecAstNode = {
  type?: string;
  value?: unknown;
  source?: { value?: unknown } | null;
  callee?: SpecAstNode | null;
  object?: SpecAstNode | null;
  property?: SpecAstNode | null;
  computed?: boolean;
  arguments?: unknown[];
  quasis?: Array<{ value: { cooked?: string | null; raw: string } }>;
  expressions?: unknown[];
  operator?: string;
  left?: unknown;
  right?: unknown;
  [k: string]: unknown;
};

/**
 * 静态字符串折叠（StringLiteral / TemplateLiteral / `+` 拼接）——
 * 与模块图（`service/src/abs-modules-graph.ts` 的 `foldStaticStringExpr`）同口径。
 */
function foldStaticSpecString(node: unknown): string | undefined {
  if (!node || typeof node !== "object") return undefined;
  const n = node as SpecAstNode;
  if (n.type === "StringLiteral") {
    return typeof n.value === "string" ? n.value : undefined;
  }
  if (n.type === "TemplateLiteral") {
    const quasis = n.quasis ?? [];
    const exprs = n.expressions ?? [];
    let out = "";
    for (let i = 0; i < quasis.length; i++) {
      out += quasis[i]!.value.cooked ?? quasis[i]!.value.raw;
      if (i < exprs.length) {
        const part = foldStaticSpecString(exprs[i]);
        if (part === undefined) return undefined;
        out += part;
      }
    }
    return out;
  }
  if (n.type === "BinaryExpression" && n.operator === "+") {
    const l = foldStaticSpecString(n.left);
    const r = foldStaticSpecString(n.right);
    if (l !== undefined && r !== undefined) return l + r;
    return undefined;
  }
  return undefined;
}

/**
 * AST 抽取的模块说明符（Bug 452）。
 *
 * 与模块图（`packages/service/src/abs-modules-graph.ts` 的 `importSpecs`）**同口径**：
 * - `ImportDeclaration` / `ExportNamedDeclaration` / `ExportAllDeclaration` 的 `source`
 * - `require(...)` / `require.resolve(...)` 的**可折叠静态字符串**实参
 *
 * 正则抽取**漏**两类形态 ⇒ 指纹**低估**真实依赖集 ⇒ 磁盘缓存键不含该依赖的
 * 内容 ⇒ 依赖改了而键不变 ⇒ `nudo check` 继续吐**上一次的陈旧签名**：
 * - **仅副作用 import**（`import "./setup.js";`）—— 三条正则分别要求
 *   `from` / `require(` / `import(`，这一形态**一个都不匹配**；
 * - **模板字符串** `require(\`./tpl.js\`)` —— 正则只认引号形式。
 *
 * 解析失败 ⇒ AST 侧零贡献 ⇒ 该形态仍不在集合里 ⇒ 指纹仍可能低估 ⇒ 故
 * **正则集与 AST 集取并集**（并集 ⊇ 正则集 ⇒ 不比现状更少；并集 ⊇ AST 集
 * ⇒ 与模块图口径对齐）⇒ **只多 miss，绝不陈旧命中**。
 */
function astLoadSpecs(source: string): string[] {
  const specs: string[] = [];
  let program: unknown;
  try {
    program = parseSource(source).program;
  } catch {
    return specs; // 解析失败 ⇒ AST 零贡献（正则集仍在 ⇒ 不引入新的低估）
  }
  const visit = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    const n = node as SpecAstNode;
    if (
      n.type === "ImportDeclaration" ||
      n.type === "ExportNamedDeclaration" ||
      n.type === "ExportAllDeclaration"
    ) {
      const v = n.source?.value;
      if (typeof v === "string") specs.push(v);
    } else if (n.type === "CallExpression" && n.callee) {
      const c = n.callee;
      const isRequire =
        (c.type === "Identifier" && c.name === "require") ||
        (c.type === "MemberExpression" &&
          !c.computed &&
          c.object?.type === "Identifier" &&
          c.object.name === "require" &&
          c.property?.type === "Identifier" &&
          c.property.name === "resolve");
      if (isRequire) {
        const spec = foldStaticSpecString(n.arguments?.[0]);
        if (spec !== undefined) specs.push(spec);
      }
    }
    for (const key of Object.keys(n)) {
      if (key === "loc" || key === "start" || key === "end") continue;
      const v = n[key];
      if (Array.isArray(v)) v.forEach(visit);
      else if (v && typeof v === "object") visit(v);
    }
  };
  visit(program);
  return specs;
}

/**
 * 源码里**可能**含模块说明符的廉价粗筛（AST 抽取前的闸）。
 * AST 可见的说明符一定带 `import` / `require` / `export` 关键字 ⇒ 粗筛不漏。
 */
function mayHaveModuleSpec(source: string): boolean {
  return source.includes("import") || source.includes("require") || source.includes("export");
}

/**
 * All string module specs that analysis may resolve through loadModule.
 *
 * 正则**过近似**（可能命中注释里的假 import）**且**在两类形态上**欠近似**
 * （仅副作用 import / 模板字符串 require）⇒ 正则集**并**AST 集（Bug 452）：
 * 并集只可能比现状**多**（more misses），不会比现状**少**（never a stale hit）。
 */
export function extractAllLoadSpecs(source: string): string[] {
  const specs = new Set<string>();
  for (const imp of extractNudoImports(source)) specs.add(imp.spec);
  // @nudo:env 路径模板（/// @nudo:env ./custom.env.ts）与
  // @nudo:mock-module "mod" from "./mock.js" 的 from 路径会改变分析结果。
  // 命名 env（es/node/web）不是 loadModule 可解析文件，只收 path-like。
  // D5=F1：env / mock-module 文法在 directive-scan 单源，此处只消费。
  const isPathLikeSpec = (spec: string): boolean =>
    spec.startsWith("./") ||
    spec.startsWith("../") ||
    spec.startsWith("/") ||
    /\.(ts|js|mjs|cjs|tsx|jsx)$/.test(spec);
  for (const name of extractFileEnvNames(source)) {
    if (isPathLikeSpec(name)) specs.add(name);
  }
  for (const rec of extractMockModuleRecords(source)) {
    if (rec.fromPath) specs.add(rec.fromPath);
  }
  const patterns = [
    /\bfrom\s*['"]([^'"]+)['"]/g,
    /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(source))) specs.add(m[1]!);
  }
  // Bug 452：AST 侧补齐正则漏掉的形态（仅副作用 import / 模板字符串 require）
  if (mayHaveModuleSpec(source)) {
    for (const spec of astLoadSpecs(source)) specs.add(spec);
  }
  return [...specs];
}

/**
 * 源里指向其他侧车的相对 spec（`.nudo.js`/`.nudo.ts`）。regex 过近似安全：
 * 多算的 dep 只带来额外 miss，绝不产生陈旧命中。LSP 隐式依赖登记共用。
 */
export function sidecarSpecsOf(source: string): string[] {
  return extractAllLoadSpecs(source).filter(
    (spec) =>
      (spec.startsWith(".") || spec.startsWith("/")) &&
      (spec.endsWith(".nudo.js") || spec.endsWith(".nudo.ts")),
  );
}

/** 单次装载尝试：miss（undefined）与读错误（throw）必须区分（#135）。 */
type LoadAttempt = { src: string | undefined; err: boolean };

/**
 * 指纹遍历对 load I/O 错误 fail-safe：读失败的内容当 miss（过近似，绝不
 * 陈旧命中），但置 err 标记 → 指纹带 `readerr:` 前缀 + readError=true，
 * 调用方（check 整文件 memo / generalize L0）fail-open 禁 memo（trunc: 先例）。
 */
function tryLoadDeps(
  loadModule: (spec: string, fromFile: string) => string | undefined,
  spec: string,
  from: string,
): LoadAttempt {
  try {
    return { src: loadModule(spec, from), err: false };
  } catch {
    return { src: undefined, err: true };
  }
}

/**
 * Fingerprint every loadModule-reachable dep (not only `*.nudo.js`), including
 * one hop of transitive specs from each dep source — plus the autoBind 侧车
 * 闭包（`sidecar:` 前缀条目）。
 *
 * 侧车吸收范围 = fromFile 自身 **与每一个成功加载的依赖文件**的旁路侧车及其
 * 递归 .nudo 依赖：跨文件被调（scan.ts checkExternalCall）会按定义文件路径
 * ambient 绑定其侧车，依赖侧车内容影响调用方报告——不进指纹则编辑后 memo
 * 陈旧命中（错诊断）。侧车 loadModule miss（无侧车文件）→ 不加任何条目。
 *
 * 注意：本扩展对 autoBind=false 与 /node_modules/ 默认**不** gate（刻意过近似，
 * 只过度失效、绝不陈旧命中——安全方向）；ambient 生效边界由
 * contract.ts 的 sidecarClosureFingerprint 负责，两者职责不同。
 *
 * Bug 1124：调用方（check.ts）可传 `opts.ambientAllowed`（ambient 绑定资格）
 * 与 `opts.ambientLoadModule`（推测性探测 loader）——autoBind 关闭时该侧车
 * 根本不会被绑定 ⇒ 不必探测；探测失败也**不得**升级成分析错误（门禁假红），
 * 但仍须让本轮指纹不可信（readError ⇒ 禁 memo，错误轮与 miss 轮不共用键）。
 */
export function loadModuleDepsFingerprint(
  source: string,
  loadModule: (spec: string, fromFile: string) => string | undefined,
  fromFile: string,
  opts?: LoadDepsFingerprintOpts,
): LoadDepsFingerprint {
  /**
   * 指纹 / 磁盘键用的**分析稳定**内容（ABS-18）。
   *
   * 入口自身的缓存键早就用 `stableAnalyzeKeySource`（尾部注释/空白不进键），
   * 依赖侧此前却直接 hash 原始字节 ⇒ 只改依赖末尾注释也会让整条依赖链 miss。
   * 两侧对齐后：`@nudo` 指令、真实代码、行号变化仍翻转；尾部 inert 注释/空白
   * 不翻转。返回的 content 也是 `contents` 的口径（磁盘缓存键同源）。
   */
  const stableContent = (src: string): string => stableAnalyzeKeySource(src);
  // ABS-18：轮内 memo（仅 `opts === undefined` 的调用；见上方 epoch 说明）
  const epoch = depFpEpoch;
  const epochKey =
    epoch !== null && opts === undefined
      ? `${stablePathKey(fromFile)}\0${depFpLoaderId(loadModule)}\0${stableContent(source)}`
      : null;
  if (epochKey !== null) {
    const cached = epoch!.get(epochKey);
    if (cached !== undefined) return cached;
  }
  const parts: string[] = [];
  const paths: string[] = [];
  const contents: Array<{ path: string; content: string | null }> = [];
  const seen = new Set<string>();
  const queue: Array<{ spec: string; from: string }> = extractAllLoadSpecs(source).map(
    (spec) => ({ spec, from: fromFile }),
  );
  let n = 0;
  let truncated = false;
  let readError = false;
  /** 统一装载口：任何 throw 都让本轮指纹不可信（readerr: 前缀，禁 memo） */
  const load = (spec: string, from: string): LoadAttempt => {
    const a = tryLoadDeps(loadModule, spec, from);
    if (a.err) readError = true;
    return a;
  };
  /**
   * ambient 侧车探测口（**推测性**读，缺省 = loadModule）：读失败同样让本轮
   * 指纹不可信（readError ⇒ 键不可信、禁 memo ⇒ 错误轮与 miss 轮不共用键），
   * 但调用方可给它**未经降级闸**的 loader ⇒ 失败不升级成分析错误（Bug 1124）。
   */
  const ambientLoad = (spec: string, from: string): LoadAttempt => {
    const fn = opts?.ambientLoadModule ?? loadModule;
    const a = tryLoadDeps(fn, spec, from);
    if (a.err) readError = true;
    return a;
  };
  /** ambient 绑定资格（缺省 = 允许） */
  const ambientAllowed = opts?.ambientAllowed;

  const finish = (): LoadDepsFingerprint => {
    parts.sort();
    // trunc:/readerr: 前缀同义：「键不可信」，调用方 fail-open 禁 memo。
    // 两者同时出现时 trunc: 优先（既有前缀语义不变）。
    const prefix = truncated ? "trunc:" : readError ? "readerr:" : "";
    const out: LoadDepsFingerprint = {
      fp: `${prefix}${parts.join(",")}`,
      paths,
      contents,
      truncated,
      readError,
    };
    if (epochKey !== null) epoch!.set(epochKey, out);
    return out;
  };

  /** 入口文件的 ambient 侧车 + 递归 .nudo 闭包（fromFile 与各 dep 共用） */
  const absorbSidecarClosure = (entryFile: string): void => {
    const sidecarPath = sidecarPathOf(entryFile);
    // ambient 绑定无资格（autoBind 关 / 树外 / node_modules）⇒ 该侧车不会被
    // 绑定 ⇒ 探测无意义（Bug 1124：不读盘、不进指纹）。
    if (ambientAllowed !== undefined && !ambientAllowed(sidecarPath)) return;
    if (seen.has(sidecarPath)) return;
    const sidecarSpec = `./${sidecarPath.slice(sidecarPath.lastIndexOf("/") + 1)}`;
    const root = ambientLoad(sidecarSpec, entryFile);
    if (root.err) {
      // 根侧车读错误 ≠ 无侧车：fp 由 readerr: 前缀标记；contents 补 null 条目，
      // 让磁盘缓存消费方（dep-contents → hasBareMiss）与主 BFS 读错误同口径
      // fail-closed，而不是按「无侧车」形状写缓存键（#135，值等价但防不变形）。
      paths.push(sidecarPath);
      contents.push({ path: sidecarPath, content: null });
      return;
    }
    if (root.src === undefined) return; // 无侧车文件：零回归
    const sidecarSrc = root.src;
    if (n >= MAX_LOAD_DEP_NODES) {
      truncated = true;
      return;
    }
    seen.add(sidecarPath);
    n++;
    const stableSidecar = stableContent(sidecarSrc);
    parts.push(`sidecar:${sidecarPath}=${hashSource(stableSidecar)}`);
    paths.push(sidecarPath);
    contents.push({ path: sidecarPath, content: stableSidecar });
    const sidecarQueue: Array<{ spec: string; from: string }> = sidecarSpecsOf(
      sidecarSrc,
    ).map((spec) => ({ spec, from: sidecarPath }));
    while (sidecarQueue.length > 0) {
      if (n >= MAX_LOAD_DEP_NODES) {
        truncated = true;
        return;
      }
      const cur = sidecarQueue.shift()!;
      const path = resolveDepPath(cur.from, cur.spec);
      if (seen.has(path)) continue;
      seen.add(path);
      n++;
      const src = ambientLoad(cur.spec, cur.from).src;
      const stableSrc = src === undefined ? undefined : stableContent(src);
      parts.push(`sidecar:${path}=${stableSrc === undefined ? "miss" : hashSource(stableSrc)}`);
      paths.push(path);
      contents.push({ path, content: stableSrc ?? null });
      if (src === undefined) continue;
      for (const next of sidecarSpecsOf(src)) {
        const nextPath = resolveDepPath(path, next);
        if (!seen.has(nextPath)) sidecarQueue.push({ spec: next, from: path });
      }
    }
  };

  while (queue.length > 0) {
    if (n >= MAX_LOAD_DEP_NODES) {
      truncated = true;
      break;
    }
    const cur = queue.shift()!;
    const path = resolveDepPath(cur.from, cur.spec);
    if (seen.has(path)) continue;
    seen.add(path);
    n++;
    const src = load(cur.spec, cur.from).src;
    const stableSrc = src === undefined ? undefined : stableContent(src);
    parts.push(`${path}=${stableSrc === undefined ? "miss" : hashSource(stableSrc)}`);
    paths.push(path);
    contents.push({ path, content: stableSrc ?? null });
    if (src === undefined) continue;
    for (const next of extractAllLoadSpecs(src)) {
      const nextPath = resolveDepPath(path, next);
      if (!seen.has(nextPath)) queue.push({ spec: next, from: path });
    }
    // 依赖文件的 ambient 侧车也进指纹与逐出索引（跨文件被调会绑定它）
    absorbSidecarClosure(path);
  }
  // fromFile 自身的侧车闭包（侧车被显式 import 时主 BFS 已覆盖，seen 命中跳过）
  absorbSidecarClosure(fromFile);
  return finish();
}
