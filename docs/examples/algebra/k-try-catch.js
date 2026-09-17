// 示例 K：try/catch 精度
// 考察：确定性 return 路径静态选支（try 体无抛点 → 折叠为字面量）；
// catch 形参绑定 thrown Abs（Error 家族带 name/message 槽）。
//
// 逐 case 真值（infer 输出）：
//   fold()    → "inner"  #exact（try 体确定性 return，catch 分支不可达）
//   caught()  → "boom"   #exact（throw new Error → catch err.message 可解）
//
// 边界形态（写算法前先查这张表）：
//   已建模：try 体确定性 return 折叠（无抛点 → 精确字面量）
//   已建模：catch 形参绑定 thrown Abs；Error 家族 name/message 进 brand 槽

/**
 * @nudo:case "fold" ()
 */
function fold() {
  try {
    return "inner";
  } catch (e) {
    return "inner-catch";
  }
}

/**
 * @nudo:case "caught" ()
 */
function caught() {
  try {
    throw new Error("boom");
  } catch (err) {
    return err.message;
  }
}

export { fold, caught };
