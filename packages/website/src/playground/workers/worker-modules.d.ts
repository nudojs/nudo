/**
 * monaco-editor 的 worker 入口是纯 JS（无 .d.ts）；经 exports 映射
 * `./*.js → ./esm/vs/*.js` 引用。仅 side-effect import，无类型面。
 */
declare module "monaco-editor/language/typescript/ts.worker.js";
declare module "monaco-editor/editor/editor.worker.js";
