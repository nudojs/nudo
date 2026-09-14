---
"@nudojs/cli": minor
---

dist 产物自包含：`@nudojs/*` 依赖经 tsconfig paths 指向兄弟源码并被 noExternal 打进 bundle（splitting:false，单文件 bin）。此前 dist 仍 external 引用 `.ts` 源码依赖，Node 的类型剥离拒绝 node_modules 下的 `.ts`，导致安装后的 CLI 无法运行（需要消费者把源码复制出 node_modules 的 workaround）。新增 tsconfig.build.json（rootDir 拓宽以容纳 paths 映射的源码）；banner 补齐 `__filename`/`__dirname`（修复内联 CJS 依赖如 typescript/debug 的 ESM 互操作崩溃）。
