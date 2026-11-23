/**
 * TS NodeNext 的「声明相对说明符」改写（BUG-035）。
 *
 * `.ts` / `.mts` 源码里 `import { add } from "./lib.js"` 是 TS 官方推荐写法
 * （说明符写**编译产物**后缀），`tsc` 会先把它改回源后缀（`./lib.ts`）再查盘。
 * 旧候选表只做 `p` / `p+ext` / `p/index+ext` 拼接、`p` 已是 `.../lib.js`
 * ⇒ 探到 `lib.js.js` / `lib.js.ts` ⇒ `nudo:module-missing` 假红，且跨模块
 * 调用证据一并丢失（被调返回值退成 `unknown`）。
 *
 * 按**引用方扩展名**生成改写候选，放在候选表最前（命中即优先）；改写文件
 * 不存在时 statSync 自然 miss，回落既有候选表，不改任何旧行为。
 *
 * 改写表必须与 `tsc` 同口径（不能按引用方格式自己发明）：
 * - `.js` → `lib.ts` / `lib.tsx` / `lib.d.ts`，**对全部 `.ts/.tsx/.mts/.cts`
 *   引用方相同**——tsc 不按引用方把 `.js` 换成 `.mts`/`.cts`（`.mts` 引用方
 *   + 只有 `lib.mts` ⇒ TS2307；+ `lib.ts` ⇒ OK）；
 * - `.mjs` → `lib.mts`，`.cjs` → `lib.cts`（格式后缀各归各）；
 * - `.jsx` → `lib.tsx` / `lib.ts`。
 *
 * 运行时模块加载（`load-module.ts`）与类型注解解析
 * （`type-annotation-resolve.ts`）必须共用这一份表，否则同一 specifier 在
 * 求值面和 dts 注解面会解析到不同文件。
 */
import { extname } from "node:path";

export function nodeNextSpecRewrites(spec: string, fromFile: string): string[] {
  const importerExt = extname(fromFile).toLowerCase();
  if (
    importerExt !== ".ts" &&
    importerExt !== ".tsx" &&
    importerExt !== ".mts" &&
    importerExt !== ".cts"
  ) {
    return [];
  }
  const m = /\.(js|jsx|mjs|cjs)$/.exec(spec);
  if (!m) return [];
  const stem = spec.slice(0, -m[0].length);
  switch (m[1]) {
    case "mjs":
      return [`${stem}.mts`];
    case "cjs":
      return [`${stem}.cts`];
    case "jsx":
      // `.jsx` 说明符对应 `.tsx` 源；同时试 `.ts`（同一产物后缀的宽松口径）
      return [`${stem}.tsx`, `${stem}.ts`];
    default:
      // `.js` 是**声明相对**后缀：与引用方扩展名无关，固定试 TS 源后缀。
      return [`${stem}.ts`, `${stem}.tsx`, `${stem}.d.ts`];
  }
}
