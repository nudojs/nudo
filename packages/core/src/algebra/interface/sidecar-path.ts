/**
 * 侧车/依赖路径纯函数（leaf 模块：零依赖，供 load-deps-fp / interface /
 * refine / LSP 共享单一定义——历史上三份内联拷贝已各自漂移过）。
 */

export function normPath(p: string): string {
  return p.replace(/\\/g, "/");
}

/**
 * 稳定路径键：统一 Windows 盘符形态（`file:///c:/x` / `/c:/x` / `c:\x` / `c:/x` /
 * `C:/x` → `c:/x`），POSIX 绝对路径过 normPath 后恒等。幂等。
 *
 * L0 memo 依赖索引与定向逐出、模块图脏传播查找必须走同一键——否则跨形态
 * 逐出/脏传播在 Windows 上 miss（FIX-RESIDUAL-3）。core 不引 path：此处只做
 * 纯字符串归一，相对路径的 resolve 由宿主（LSP cacheKey）负责。
 */
export function stablePathKey(p: string): string {
  let fp = p;
  if (fp.startsWith("file://")) {
    fp = fp.slice("file://".length);
    try {
      fp = decodeURIComponent(fp);
    } catch {
      /* 非法 percent-escape：保留原样 */
    }
  }
  fp = normPath(fp);
  // uriToFilePath / path.resolve 会留下 `/c:/x` 前导斜杠——剥掉才是盘符绝对
  const drive = /^\/([A-Za-z]:)(.*)$/.exec(fp);
  if (drive) fp = `${drive[1]}${drive[2]}`;
  // 盘符大小写在 Windows 不敏感：统一小写，避免 C:/ 与 c:/ 撞成两个键
  if (/^[A-Za-z]:\//.test(fp)) return fp[0]!.toLowerCase() + fp.slice(1);
  return fp;
}

/**
 * 把 `buildModuleGraph` 的 imports/dependents 边表按键形态归一到 stablePathKey。
 * 边目标来自 resolveModuleFile（fs 原生，如 `c:\a.js`）、from 节点可能已是
 * 键形态（`c:/a.js`）——混形态会让 computeDirtySet 跨形态查找漏边。
 */
export function stablePathKeyGraph(
  m: Map<string, Set<string>>,
): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const [k, vs] of m) {
    const key = stablePathKey(k);
    let set = out.get(key);
    if (!set) {
      set = new Set<string>();
      out.set(key, set);
    }
    for (const v of vs) set.add(stablePathKey(v));
  }
  return out;
}

/** core 不引 path：相对 spec 纯字符串拼接（与 LSP resolve 对齐时双方 norm） */
export function resolveDepPath(fromFile: string, spec: string): string {
  const s = normPath(spec);
  if (!s.startsWith(".")) return s;
  const from = normPath(fromFile);
  const i = from.lastIndexOf("/");
  const base = i >= 0 ? from.slice(0, i) : "";
  const parts = base ? base.split("/") : [];
  for (const seg of s.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") parts.pop();
    else parts.push(seg);
  }
  return parts.join("/");
}

/**
 * 是否落在 node_modules 下（相对/绝对/盘符形态统一）。
 * autoBind 永不 ambient 加载 node_modules 侧车（§2.2）——必须在 normPath
 * 之后判定，否则 `node_modules/pkg/x.js`（无前导 `/`）会绕过守卫。
 */
export function isNodeModulesPath(p: string): boolean {
  const f = normPath(p);
  if (f === "node_modules" || f.startsWith("node_modules/")) return true;
  return f.includes("/node_modules/") || f.endsWith("/node_modules");
}

/**
 * 源文件的旁路侧车路径：.js/.mjs → 同名 .nudo.js；.ts/.mts → 同名 .nudo.ts。
 * 其他扩展名（.cjs/.jsx/无扩展名…）不做替换，直接追加 .nudo.js——侧车约定
 * 只覆盖四类入口；host loadModule 对不存在的路径返回 miss，自然无侧车来源。
 *
 * **幂等**（Bug 362）：输入本身已是侧车（`lib.nudo.js` / `lib.nudo.ts`）时
 * **不再追加第二段** `.nudo`。旧口径产出 `lib.nudo.nudo.js`——该路径不是任何
 * 源码的侧车 ⇒ 契约永久静默失效；草稿面还会落到 `lib.nudo.nudo.draft.js`
 * 并指示用户「copy it into lib.nudo.nudo.js」（一个不存在的侧车名）。
 *
 * **`.d.ts` / `.d.mts` 先剥 `.d` 段**（BUG-264）：`api.d.ts` 旧口径剥 `.ts`
 * 得 `api.d` 再挂 `.nudo.ts` ⇒ `api.d.nudo.ts`——basename 里含 `.d.` ⇒
 * TypeScript 的 `getDeclarationFileExtension` 判它是**声明文件** ⇒
 * `export const x = <表达式>` 在 ambient context 非法（TS1254）⇒ 侧车/草稿
 * 都过不了消费端 `tsc --strict`。现在 `api.d.ts → api.nudo.ts`
 * （草稿 `api.nudo.draft.ts`，同样不含 `.d.`）。
 * 旧名 `api.d.nudo.ts` 也归一到新名（升级时不会留下两套视图）。
 */
export function sidecarPathOf(file: string): string {
  const f = normPath(file);
  // 已有 `.nudo` 段 ⇒ 先剥掉再挂目标扩展名（`.nudo` 段本身不是扩展名）
  const stripNudo = (base: string): string =>
    base.endsWith(".nudo") ? base.slice(0, -5) : base;
  const withExt = (base: string, ext: string): string => stripNudo(base) + ext;
  // `.d` 段不是模块名的一部分：`.d.ts` / `.d.mts` 的声明文件源
  // （顺序：先剥 `.nudo` 再剥 `.d`——`api.d.nudo.ts` 也要归一到 `api.nudo.ts`）
  const declBase = (base: string): string => {
    const b = stripNudo(base);
    return b.endsWith(".d") ? b.slice(0, -2) : b;
  };
  if (f.endsWith(".mjs")) return withExt(f.slice(0, -4), ".nudo.js");
  if (f.endsWith(".js")) return withExt(f.slice(0, -3), ".nudo.js");
  if (f.endsWith(".mts")) return declBase(f.slice(0, -4)) + ".nudo.ts";
  if (f.endsWith(".ts")) return declBase(f.slice(0, -3)) + ".nudo.ts";
  return withExt(f, ".nudo.js");
}
