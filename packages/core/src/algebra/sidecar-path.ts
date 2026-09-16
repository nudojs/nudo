/**
 * 侧车/依赖路径纯函数（leaf 模块：零依赖，供 load-deps-fp / interface /
 * refine / LSP 共享单一定义——历史上三份内联拷贝已各自漂移过）。
 */

export function normPath(p: string): string {
  return p.replace(/\\/g, "/");
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
 * 源文件的旁路侧车路径：.js/.mjs → 同名 .nudo.js；.ts/.mts → 同名 .nudo.ts。
 * 其他扩展名（.cjs/.jsx/无扩展名…）不做替换，直接追加 .nudo.js——侧车约定
 * 只覆盖四类入口；host loadModule 对不存在的路径返回 miss，自然无侧车来源。
 */
export function sidecarPathOf(file: string): string {
  const f = normPath(file);
  if (f.endsWith(".mjs")) return f.slice(0, -4) + ".nudo.js";
  if (f.endsWith(".js")) return f.slice(0, -3) + ".nudo.js";
  if (f.endsWith(".mts")) return f.slice(0, -4) + ".nudo.ts";
  if (f.endsWith(".ts")) return f.slice(0, -3) + ".nudo.ts";
  return `${f}.nudo.js`;
}
