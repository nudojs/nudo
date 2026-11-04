/**
 * 自托管 monaco 基础 worker 的入口包装（同 ts.worker.ts 的相对路径理由：
 * webpack 只对 `new URL("./…", import.meta.url)` 做 worker chunk emit）。
 */
import "monaco-editor/editor/editor.worker.js";
