/**
 * 数组 / 对象运行时：$arr/$idx/$len/$arrMutContainer 与 $obj/$get/$set/$spread。
 *
 * 按域拆分（barrel 保持原导入面不变，纯 re-export）：
 * - arr-make      元组/数组构造与宽化（$arr/$arguments/rest 哨兵/widenTupleToArr）
 * - arr-methods   就地 mutator 族（push/pop/splice/sort/copyWithin/fill）
 * - arr-index     下标读写与长度（$idx/$idxSet/$len + abstractLen memo）
 * - obj           对象构造/展开/rest + 容器快照（$obj/$spread/$copy）
 * - iterate       迭代协议与 spread/rest 投影（$elems/$forOf/$concat/$arrRest）
 * - member        成员读写与命名空间/原型派发（$get/$set/NAMESPACE_GLOBALS）
 * - guarded-entry 入口守卫层（BUG-173 this 门 / BUG-215 迭代槽 / BUG-217
 *                 访问器分流：$idx/$get/$set/$idxSet/$iterCheck 包 Inner）
 */
export {
  privateNameGuard,
  $copy,
  $obj,
  $setProto,
  $spread,
  $objRest,
} from "./containers/obj.ts";
export {
  tupleOrWiden,
  $arr,
  $arguments,
  $arrWithHoles,
  makeSymbolicRestAbs,
  isSymbolicRestAbs,
  $restBind,
  widenTupleToArr,
} from "./containers/arr-make.ts";
export {
  ARR_MUTATORS,
  isArrMutator,
  toIOI,
  clampWindow,
  copyWithinTuple,
  fillTuple,
  sortTupleAbs,
  $arrMutContainer,
} from "./containers/arr-methods.ts";
export {
  $idx,
  $idxSet,
  $elems,
  $forOf,
  $get,
  $iterCheck,
  $set,
} from "./containers/guarded-entry.ts";
export {
  $len,
} from "./containers/arr-index.ts";
export {
  $arrRest,
  $concat,
  $yieldStarElems,
  $tpl,
  $forInKeys,
  $collectionForEach,
} from "./containers/iterate.ts";
export {
  NAMESPACE_GLOBALS,
  namespaceNameOf,
  $regex,
  setProtoMethodDispatch,
  protoMethodValueAbs,
} from "./containers/member.ts";
