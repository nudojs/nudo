// 示例 F：异步效应链
// 考察：eff("promise") 的引入/消除；@nudo:mock 替换内置 API（fetch 无真实 I/O）
//
// loadUser(42)：case 头（Abs 投影）为 promise<{ id: 1, name: "ada" }>，abs 走 mock 闭包
// → promise<{ id: 1, name: "ada" }> #path：fetch 返回 { ok: true, json: fn }，
// res.ok=true 使 throw 分支不可达；res.json() 经 mock 闭包求值
//
// 注意：@nudo:mock 必填——宿主副作用全局（fetch 等）在分析期被拦下、
// 不真实执行：结果加宽 unknown#opaque，并上报 nudo:host-effect-blocked
// （Info）——整轮不崩、退出码不受影响，只是类型精度退化。这里用块注释
// 形态（行注释 // @nudo:mock 同样生效，但看起来像被注释掉的代码，易误读）。
//
// 坑：@nudo:mock 缺失时 fetch 的返回值退成 unknown（见上）；另顶层
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
