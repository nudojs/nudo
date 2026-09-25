/**
 * 静态声明导出名回收 —— run.ts 与测试共用。
 *
 * 格式耦合点：B 路径 transpile 的发射约定是——顶层 function 声明一律带
 * `export ` 前缀（含未写 export 的，见 stmt.ts exportKw），顶层 export
 * const/let/class 以 `export (const|let) <name>` 发射（class 折成 `let X = $class`）。
 * 因此用正则从生成文本回收导出名。刻意不走 AST——历史口径要复现既有 quirk：
 * 多声明式 `export const a=1,b=2` 只有首绑定在 export 行（只收 a），解构
 * `export const {p}=obj` 发射为 `export const <临时名> = obj`（只收临时名）。
 *
 * 若 transpile 改发射格式，本函数与 __tests__/run-export-names.test.ts 须同步。
 * 本模块刻意不进 exec/index.ts 桶导出（不属公开面），仅 run.ts + 测试引用。
 */

/**
 * 收集静态声明导出名（`export function` / `export (const|let)`）并剥掉 export
 * 关键字（→ `function` / `let`），使这些声明成为可被返回对象简写引用的局部绑定。
 * 去重顺序沿旧口径：先全部 function 名，后全部 const/let 名。
 */
export function stripStaticExportDecls(js: string): { names: string[]; js: string } {
  const exportFns = [...js.matchAll(/^export function (\w+)/gm)].map((m) => m[1]!);
  js = js.replace(/^export function /gm, "function ");
  const exportConsts = [...js.matchAll(/^export (?:const|let) (\w+)/gm)].map((m) => m[1]!);
  js = js.replace(/^export (?:const|let) /gm, "let ");
  return { names: [...new Set([...exportFns, ...exportConsts])], js };
}
