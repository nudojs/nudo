/**
 * 自托管 Monaco。@monaco-editor/react 默认从 jsdelivr CDN 运行时拉取
 * monaco —— 离线/Docs 镜像网络/CSP 下 Playground 直接不可用。改为把
 * monaco-editor 打进 playground 异步 chunk（路由级懒加载，不进文档首屏）。
 *
 * worker 分派：MonacoEnvironment.getWorker 一旦定义就**接管全部** monaco worker
 * （internal/common/workers.js 的 getWorker 里它优先于 monaco 自带的
 * createWorker 兜底，tsc 面板的 TS worker 也走这里）——必须按 label 分派：
 * editor 基础 worker 服务主线程编辑器；javascript/typescript label 给完整
 * TS 语言服务 worker（monaco-editor 自带，webpack 编译成独立懒 chunk，仅
 * tsc 面板开启且首个 JS 模型请求校验时才下载）。
 */
import * as monaco from "monaco-editor";
import { loader } from "@monaco-editor/react";

self.MonacoEnvironment = {
  getWorker(_workerId: string, label: string) {
    // ⚠ webpack 的 worker 检测只认 **相对路径字面量**（`new URL("./x", import.meta.url)`）；
    // 裸包名（`new URL("monaco-editor/…")`）不会被 emit 成 worker chunk——运行时
    // URL 解析到站点路径 ⇒ 404 ⇒ monaco 回退 blob+importScripts ⇒ `URL is invalid`
    // ⇒ tsc 面板永远停在 “computing…”。故经相对 wrapper（./workers/*.worker.ts）
    // 把 monaco 的 ESM worker 入口接进构建图。
    if (label === "javascript" || label === "typescript") {
      return new Worker(new URL("./workers/ts.worker.ts", import.meta.url), { type: "module" });
    }
    return new Worker(new URL("./workers/editor.worker.ts", import.meta.url), { type: "module" });
  },
};

loader.config({ monaco });

// tsc 对照面板直接用 monaco API（createModel / getModelMarkers）挂离屏模型，
// 不必等 @monaco-editor/react 懒挂载后经 beforeMount 回调拿实例。
export { monaco };
