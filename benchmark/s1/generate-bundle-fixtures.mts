/**
 * ABS-17 **形态/规模对照夹具**：生成 5 种「打包器导出」形态的 .js 到 gitignored `.bundles/`。
 *
 * 背景：真实仓首测误把 `packages/vscode/out/extension.js`（15 KiB esbuild
 * bundle）纳入语料，单文件 `analyzeFile` 47–59s，CPU 栈 `copyWithMemo` 26.4% +
 * GC 19.7%。最初假设是「getter 元编程 / 批量导出」造成病态。
 *
 * ⚠ 2026-11-12 实测**证伪该假设**：这 5 个夹具只是**阴性对照**，
 * 它们不触发 `copyWithMemo`（N=160 的 CPU 栈里 0%），耗时只随导出数近似平方增长
 * 且主要落在转译/模块装载。真正的病态由**模块解析上下文**触发：同一份
 * `extension.js` 在原路径可解析 `packages/vscode/node_modules` ⇒ `loadModule`
 * 362 次 / 47.2s / RSS 2.74 GiB；复制到本目录（依赖不可解析）只剩 8 次 /
 * 0.20s；在原目录去掉三个 `require` 也回到 0.21s。详见 plan §5 `ABS-17`。
 *
 * 因此本脚本的用途是「排除形态因素 + 提供可重复的规模梯度」，
 * **不是最小复现**；依赖上下文探针用 `profile-cold.mts --only` 的路径/require 对照。
 *
 * 只读仓库之外：产物落在 gitignored 目录，不进版本库；语料规模由 --count 决定。
 *
 *   pnpm exec tsx benchmark/s1/generate-bundle-fixtures.mts [--count 40]
 *   pnpm exec tsx benchmark/s1/profile-cold.mts --corpus benchmark/s1/.bundles --rounds 1
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const OUT = join(import.meta.dirname, ".bundles");
const countIdx = process.argv.indexOf("--count");
const N = countIdx === -1 ? 40 : Number(process.argv[countIdx + 1]);
if (!Number.isInteger(N) || N < 1 || N > 500) {
  console.error("--count requires an integer in [1, 500]");
  process.exit(2);
}

const names = Array.from({ length: N }, (_, i) => `fn${i}`);
const defs = names.map((n, i) => `function ${n}(x) { return x + ${i}; }`).join("\n");
const arrowMap = names.map((n) => `  ${n}: () => ${n}`).join(",\n");
const exportList = names.join(", ");
const header = `"use strict";\nvar exports = {};\nvar module = { exports };\n`;

const fixtures: Array<[string, string]> = [
  [
    "01-esbuild-getter.js",
    `${header}var __defProp = Object.defineProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var mod_exports = {};
__export(mod_exports, {
${arrowMap}
});
module.exports = mod_exports;
${defs}
`,
  ],
  [
    "02-webpack-define-exports.js",
    `${header}var __webpack_require__ = {
  o: (obj, prop) => Object.prototype.hasOwnProperty.call(obj, prop),
  d: (exp, definition) => {
    for (var key in definition) {
      if (__webpack_require__.o(definition, key) && !__webpack_require__.o(exp, key)) {
        Object.defineProperty(exp, key, { enumerable: true, get: definition[key] });
      }
    }
  }
};
__webpack_require__.d(exports, {
${arrowMap}
});
${defs}
`,
  ],
  [
    "03-rollup-esm-exports.js",
    `${defs}
export { ${exportList} };
`,
  ],
  [
    "04-plain-cjs-exports.js",
    `${header}${defs}
${names.map((n) => `exports.${n} = ${n};`).join("\n")}
`,
  ],
  [
    "05-mixed-getter-functions.js",
    `${header}var __defProp = Object.defineProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
__export(exports, {
${names
  .filter((_, i) => i % 2 === 0)
  .map((n) => `  ${n}: () => ${n}`)
  .join(",\n")}
});
${defs}
${names
  .filter((_, i) => i % 2 === 1)
  .map((n) => `exports.${n} = ${n};`)
  .join("\n")}
`,
  ],
];

mkdirSync(OUT, { recursive: true });
for (const [name, src] of fixtures) writeFileSync(join(OUT, name), src);
console.log(`ABS-17 fixtures → ${OUT} (${fixtures.length} files, ${N} exports each)`);
for (const [name, src] of fixtures) console.log(`  ${name.padEnd(34)} ${src.length} bytes`);
