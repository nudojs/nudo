/**
 * 自托管 Monaco。@monaco-editor/react 默认从 jsdelivr CDN 运行时拉取
 * monaco —— 离线/Docs 镜像网络/CSP 下 Playground 直接不可用。改为把
 * monaco-editor 打进 playground 异步 chunk（路由级懒加载，不进文档首屏）。
 *
 * 只需 editor 基础 worker：TS/JS/JSON 语言服务在 PlaygroundApp 中被显式
 * 静音（noSemanticValidation 等），自定义 nudo-js 语言走 Monarch（无 worker）。
 */
import * as monaco from "monaco-editor";
import { loader } from "@monaco-editor/react";

self.MonacoEnvironment = {
  getWorker() {
    // monaco-editor exports 映射 './*.js' → './esm/vs/*.js'(通配已含 esm/vs),
    // 直接写 ./esm/vs/... 会被映射成 esm/vs/esm/vs/... → 404。
    return new Worker(
      new URL("monaco-editor/editor/editor.worker.js", import.meta.url),
    );
  },
};

loader.config({ monaco });
