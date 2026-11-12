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
 * 2026-11-13 补上**真正的最小复现**（`--objects N`）：单模块、无依赖，
 * N 个对象导出 + esbuild `__copyProps` / `Object.assign`，即可复现同一栈。
 * 干净 env 单文件：N=200 **619.86ms / 434 MiB**、N=800 **8427.15ms / 2030 MiB**
 * （4× 导出 → 13.6× 耗时），CPU 栈 `setSlot` 33.0% + `copyWithMemo` 31.7% +
 * GC 16.2%。⇒ 病态的最小触发面是「大对象图的 `$copy`」，不是依赖数量本身；
 * 依赖上下文只是把真实 bundle 推到这个面上的放大器。
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
/** 最小复现：单模块 N 个对象导出（0 = 不生成） */
const objectsIdx = process.argv.indexOf("--objects");
const OBJ = objectsIdx === -1 ? 0 : Number(process.argv[objectsIdx + 1]);
if (!Number.isInteger(OBJ) || OBJ < 0 || OBJ > 2000) {
  console.error("--objects requires an integer in [0, 2000]");
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

// 最小复现（--objects N）：单文件、零依赖，N 个**对象**导出 + esbuild 拷贝助手。
// 与上面 5 个「函数导出」形态的区别：每个导出是带嵌套槽的对象 ⇒ 整文件
// `__copyProps` / `Object.assign` 触发 `copyWithMemo` 的大图拷贝；
// 函数导出不会。这一条把 ABS-17 的病态压到单文件可重复计时。
if (OBJ > 0) {
  const objNames = Array.from({ length: OBJ }, (_, i) => `o${i}`);
  const bigDefs = objNames
    .map(
      (n, i) =>
        `big.${n} = { id: ${i}, label: "${n}", nested: { a: ${i}, b: String(${i}), ok: true } };`,
    )
    .join("\n");
  fixtures.push([
    "06-esbuild-object-exports.js",
    `"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var big = {};
${bigDefs}
var mod = __toCommonJS(big);
Object.assign(mod, big);
module.exports = mod;
`,
  ]);
}

mkdirSync(OUT, { recursive: true });
for (const [name, src] of fixtures) writeFileSync(join(OUT, name), src);
console.log(
  `ABS-17 fixtures → ${OUT} (${fixtures.length} files, ${N} exports each${
    OBJ > 0 ? `; object-export repro with ${OBJ} exports` : ""
  })`,
);
for (const [name, src] of fixtures) console.log(`  ${name.padEnd(34)} ${src.length} bytes`);
