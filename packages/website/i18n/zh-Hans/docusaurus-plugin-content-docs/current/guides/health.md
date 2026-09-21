---
slug: /guides/health
description: nudo health —— CI 中的分析错误与固化漂移。
---

# nudo health

`nudo health` 报告**分析错误**与**调用点固化漂移**。它与 `nudo check`（契约门禁）互补：health 盯的是已记录证据是否仍与代码匹配。

```bash
npx nudojs health [paths…] [--watch] [--from paths…] [--json]
```

漂移或分析错误时退出 `1`。未覆盖函数仅为信息级。

```bash
npx nudojs health src/ --from tests/
```

生成的 `call@` 指令会变化时，health 报告漂移并建议：

```bash
npx nudojs test lib.js --from test.js --freeze=update
```

`test --freeze` 是**可选**的调试固化工具 —— 产品 CI 门禁仍是 `nudo check`。

## CI 片段

```yaml
- run: npx nudojs check src/
- run: npx nudojs health src/ --from tests/
```

更多配方：[Recipes](./recipes.md)。

## 下一步

- [nudo check](./check.md)
- [诊断](../reference/diagnostics.md)
- [调用点发现](./callsite-discovery.md)
