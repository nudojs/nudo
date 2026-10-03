---
"vite-plugin-nudo": patch
---

fix(vite-plugin): checkSource 崩溃不再静默吞掉——默认 `this.warn("[nudo] check failed for <id>: <msg>")`，`failOnError: true` 时升级 `this.error` 红构建（与 CLI BUG-023「注入/装配失败必须红」同口径）；check 面按 (id, source) 套会话缓存，同一 build 会话内未变文件（如 client/SSR 双环境重复 transform）不重跑 check 推断链。
