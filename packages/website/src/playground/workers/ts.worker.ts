/**
 * 自托管 TS 语言服务 worker 的入口包装（相对路径 ⇒ webpack `new Worker(new
 * URL("./…", import.meta.url))` 能静态识别并 emit 独立 worker chunk）。
 *
 * 背景：monaco-local.ts 里直接写 `new URL("monaco-editor/…/ts.worker.js",
 * import.meta.url)` 是**裸包名**——webpack 的 worker 检测只认相对路径字面量，
 * 裸名会留成运行时 URL（解析到站点路径 ⇒ 404 ⇒ monaco 回退 blob + importScripts
 * ⇒ `URL is invalid`），tsc 面板永远停在 “computing…”。这里用相对 wrapper
 * 把 monaco 的 ESM worker 入口变成可静态分析的图。
 */
import "monaco-editor/language/typescript/ts.worker.js";
