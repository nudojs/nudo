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
// 坑：@nudo:mock 缺失时 B 路径会真实执行全局 fetch 崩溃（见上）；另顶层
// this（模块级 this 访问）会让转译抛 unsupported → 静默回落解释路径
// （能力判定在转译点，非源码正则；注释内容不影响判定）。

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
