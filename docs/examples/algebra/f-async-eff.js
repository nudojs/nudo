// 示例 F：异步效应链
// 考察：eff("promise") 的引入/消除；@nudo:mock 替换内置 API（fetch 无真实 I/O）
//
// loadUser(42)：case 头（Abs 投影）为 promise<{ id: 1, name: "ada" }>，abs 走 mock 闭包
// → promise<{ id: 1, name: "ada" }> #path：fetch 返回 { ok: true, json: fn }，
// res.ok=true 使 throw 分支不可达；res.json() 经 mock 闭包求值
//
// 注意：@nudo:mock 必填——B 路径（默认路径）会执行转译后的真实
// 全局 fetch，拿 Abs 当 URL 直接 ERR_INVALID_URL 崩溃（exit 1）。这里用块注释
// 形态（行注释 // @nudo:mock 同样生效，但看起来像被注释掉的代码，易误读）。
//
// 坑：注释里也别写「this 加点的访问」——B 路径能力探测按原始源码正则匹配
// this 访问，注释命中会静默退化到 ast-eval 路径（无 mock 注入 →
// promise<unknown>）。

/**
 * @nudo:mock fetch = (url) => ({ ok: true, json: () => ({ id: 1, name: "ada" }) })
 */
async function loadUser(id) {
  const res = await fetch(`/users/${id}`);
  if (!res.ok) throw new Error("fail");
  return res.json();
}

loadUser(42);

export { loadUser };
