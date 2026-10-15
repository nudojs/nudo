/**
 * 数组 / 对象运行时：$arr/$idx/$len/$arrMutContainer 与 $obj/$get/$set/$spread。
 *
 * 按域拆分（barrel 保持原导入面不变）：
 * - arr-make    元组/数组构造与宽化（$arr/$arguments/rest 哨兵/widenTupleToArr）
 * - arr-methods 就地 mutator 族（push/pop/splice/sort/copyWithin/fill）
 * - arr-index   下标读写与长度（$idx/$idxSet/$len + abstractLen memo）
 * - obj         对象构造/展开/rest + 容器快照（$obj/$spread/$copy）
 * - iterate     迭代协议与 spread/rest 投影（$elems/$forOf/$concat/$arrRest）
 * - member      成员读写与命名空间/原型派发（$get/$set/NAMESPACE_GLOBALS）
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
  $len,
} from "./containers/arr-index.ts";
export {
  $arrRest,
  $concat,
  $iterCheck,
  $elems,
  $yieldStarElems,
  $tpl,
  $forInKeys,
  $forOf,
  $collectionForEach,
} from "./containers/iterate.ts";
export {
  NAMESPACE_GLOBALS,
  namespaceNameOf,
  $regex,
  setProtoMethodDispatch,
  protoMethodValueAbs,
  $get,
  $set,
} from "./containers/member.ts";
