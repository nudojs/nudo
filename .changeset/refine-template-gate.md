---
"@nudojs/core": patch
---

Fix refine template gate for array()/string() and stop body method calls from inventing object shapes: typeof preds are checked at call sites, refine contracts take priority over structural inference, method names (`p.some`/`p.replace`) are no longer required data fields, array() constraints produce arr entry Abs, and `{...base}` call-site args resolve file-level bindings.
