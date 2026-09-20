/**
 * 结构化三方合并核心。
 *
 * 输入 base / local / remote 三份 JSON，产出一棵 MergeNode 树：
 * 无冲突的改动被自动合并，真正的冲突以 conflict 节点保留在树中，
 * 由用户逐项决策（base / local / remote）后通过 materialize 得到最终文档。
 *
 * 覆盖的语义：
 *  - 对象字段的新增 / 删除 / 修改
 *  - 数组元素按稳定 id 对齐（元素为含 id 的对象时），否则按位置对齐
 *  - 父节点删除 vs 子节点修改（delete-vs-modify）
 *  - 同一路径的类型变化（type-change）
 *  - 数组重排：单侧重排自动采用；双侧不同重排产生 array-order 冲突
 */

export type JSONValue =
  | string
  | number
  | boolean
  | null
  | JSONValue[]
  | { [key: string]: JSONValue };

export type JSONObject = { [key: string]: JSONValue };

/** 三方案例中某一侧的值；present=false 表示该侧此路径不存在（被删除或从未有过）。 */
export interface Side {
  present: boolean;
  value?: JSONValue;
}

export const absentSide: Side = { present: false };
export const sideOf = (value: JSONValue): Side => ({ present: true, value });

export type PathSeg =
  | { kind: 'key'; key: string }
  | { kind: 'item'; id: string };

export type ConflictKind =
  | 'both-modify'
  | 'both-add'
  | 'delete-vs-modify'
  | 'type-change'
  | 'array-order';

export type Decision = 'base' | 'local' | 'remote';
export type DecisionMap = Record<string, Decision>;

export interface ConflictNode {
  kind: 'conflict';
  id: string;
  path: PathSeg[];
  conflictKind: Exclude<ConflictKind, 'array-order'>;
  base: Side;
  local: Side;
  remote: Side;
}

export interface OrderConflict {
  id: string;
  path: PathSeg[];
  base: Side;
  local: Side;
  remote: Side;
}

export interface ArrayItem {
  /** 树内唯一 key：id 对齐时为 `id:<id>`，位置对齐时为 `idx:<n>` */
  key: string;
  /** 展示用标签 */
  label: string;
  node: MergeNode;
}

export type MergeNode =
  | { kind: 'value'; value: JSONValue }
  | { kind: 'object'; children: Record<string, MergeNode> }
  | { kind: 'array'; items: ArrayItem[]; orderConflict?: OrderConflict }
  | ConflictNode;

export interface ConflictInfo {
  id: string;
  path: PathSeg[];
  pathDisplay: string;
  kind: ConflictKind;
  base: Side;
  local: Side;
  remote: Side;
}

export interface MergeResult {
  root: MergeNode;
  conflicts: ConflictInfo[];
}

/* ------------------------------------------------------------------ */
/* 工具                                                                */
/* ------------------------------------------------------------------ */

/** 键排序后的稳定序列化，用于深比较。 */
export function stableStringify(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null';
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  const obj = v as Record<string, unknown>;
  const keys = Object.keys(obj).filter((k) => obj[k] !== undefined).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
}

const sideEq = (a: Side, b: Side) => stableStringify(a) === stableStringify(b);

const isPlainObject = (v: JSONValue): v is JSONObject =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const sideIsObject = (s: Side): s is Side & { value: JSONObject } =>
  s.present && isPlainObject(s.value!);

const sideIsArray = (s: Side): s is Side & { value: JSONValue[] } =>
  s.present && Array.isArray(s.value);

function jsonType(v: JSONValue | undefined): string {
  if (v === undefined) return 'absent';
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v;
}

export function formatPath(path: PathSeg[]): string {
  let out = '$';
  for (const seg of path) {
    out += seg.kind === 'key' ? `.${seg.key}` : `[${seg.id}]`;
  }
  return out;
}

const conflictId = (path: PathSeg[]) => `c:${JSON.stringify(path)}`;
const orderConflictId = (path: PathSeg[]) => `o:${JSON.stringify(path)}`;

/* ------------------------------------------------------------------ */
/* 合并                                                                */
/* ------------------------------------------------------------------ */

export function mergeDocuments(
  base: JSONValue,
  local: JSONValue,
  remote: JSONValue,
): MergeResult {
  const root = mergeNode([], sideOf(base), sideOf(local), sideOf(remote));
  const conflicts: ConflictInfo[] = [];
  if (root) collectConflicts(root, conflicts);
  return { root: root ?? { kind: 'value', value: null }, conflicts };
}

/** 返回 null 表示该节点在三方合并后不存在。 */
function mergeNode(path: PathSeg[], base: Side, local: Side, remote: Side): MergeNode | null {
  // 两侧结果一致（含双双删除）：直接采用
  if (sideEq(local, remote)) return local.present ? nodeFromValue(local.value!) : null;
  // 仅 remote 改了 / 仅 local 改了：采用改动方
  if (sideEq(base, local)) return remote.present ? nodeFromValue(remote.value!) : null;
  if (sideEq(base, remote)) return local.present ? nodeFromValue(local.value!) : null;

  // 三方互不相同
  if (base.present && local.present && remote.present) {
    if (sideIsObject(base) && sideIsObject(local) && sideIsObject(remote)) {
      return mergeObject(path, base.value, local.value, remote.value);
    }
    if (sideIsArray(base) && sideIsArray(local) && sideIsArray(remote)) {
      return mergeArray(path, base.value, local.value, remote.value);
    }
    return makeConflict(path, 'type-change', base, local, remote);
  }
  if (!base.present) {
    // base 没有、双方各自新增了不同的值
    return makeConflict(path, 'both-add', base, local, remote);
  }
  // base 有、一侧删除另一侧修改
  return makeConflict(path, 'delete-vs-modify', base, local, remote);
}

function makeConflict(
  path: PathSeg[],
  kind: ConflictNode['conflictKind'],
  base: Side,
  local: Side,
  remote: Side,
): ConflictNode {
  return { kind: 'conflict', id: conflictId(path), path, conflictKind: kind, base, local, remote };
}

/** 无冲突子树原样转为一棵 MergeNode（保留结构供树形审阅展示）。 */
function nodeFromValue(value: JSONValue): MergeNode {
  if (isPlainObject(value)) {
    const children: Record<string, MergeNode> = {};
    for (const k of Object.keys(value)) children[k] = nodeFromValue(value[k]);
    return { kind: 'object', children };
  }
  if (Array.isArray(value)) {
    return {
      kind: 'array',
      items: value.map((v, i) => ({
        key: `idx:${i}`,
        label: String(i),
        node: nodeFromValue(v),
      })),
    };
  }
  return { kind: 'value', value };
}

function mergeObject(
  path: PathSeg[],
  base: JSONObject,
  local: JSONObject,
  remote: JSONObject,
): MergeNode {
  const keys = new Set([...Object.keys(base), ...Object.keys(local), ...Object.keys(remote)]);
  const children: Record<string, MergeNode> = {};
  for (const key of keys) {
    const child = mergeNode(
      [...path, { kind: 'key', key }],
      key in base ? sideOf(base[key]) : absentSide,
      key in local ? sideOf(local[key]) : absentSide,
      key in remote ? sideOf(remote[key]) : absentSide,
    );
    if (child) children[key] = child;
  }
  return { kind: 'object', children };
}

/* ------------------------------ 数组 ------------------------------ */

type ArrayEntry = { key: string; label: string; value: JSONValue };

function isIdArray(arr: JSONValue[]): boolean {
  return arr.every(
    (el) => isPlainObject(el) && (typeof el.id === 'string' || typeof el.id === 'number'),
  );
}

function entriesOf(arr: JSONValue[], byId: boolean): ArrayEntry[] {
  return arr.map((v, i) => {
    if (byId) {
      const id = String((v as JSONObject).id);
      return { key: `id:${id}`, label: `id=${id}`, value: v };
    }
    return { key: `idx:${i}`, label: String(i), value: v };
  });
}

function mergeArray(
  path: PathSeg[],
  base: JSONValue[],
  local: JSONValue[],
  remote: JSONValue[],
): MergeNode {
  const byId = isIdArray(base) && isIdArray(local) && isIdArray(remote);
  const bEntries = entriesOf(base, byId);
  const lEntries = entriesOf(local, byId);
  const rEntries = entriesOf(remote, byId);

  const bMap = new Map(bEntries.map((e) => [e.key, e]));
  const lMap = new Map(lEntries.map((e) => [e.key, e]));
  const rMap = new Map(rEntries.map((e) => [e.key, e]));

  // 键的并集，顺序：base 顺序 → local 新增 → remote 新增
  const allKeys: string[] = [];
  const seen = new Set<string>();
  for (const e of [...bEntries, ...lEntries, ...rEntries]) {
    if (!seen.has(e.key)) {
      seen.add(e.key);
      allKeys.push(e.key);
    }
  }

  const itemSeg = (key: string, label: string): PathSeg => ({
    kind: 'item',
    id: byId ? label : `#${label}`,
  });

  const nodes = new Map<string, ArrayItem>();
  for (const key of allKeys) {
    const b = bMap.get(key), l = lMap.get(key), r = rMap.get(key);
    const label = (b ?? l ?? r)!.label;
    const node = mergeNode(
      [...path, itemSeg(key, label)],
      b ? sideOf(b.value) : absentSide,
      l ? sideOf(l.value) : absentSide,
      r ? sideOf(r.value) : absentSide,
    );
    if (node) nodes.set(key, { key, label, node });
  }

  // 顺序合并：仅比较三方共同保留的键的相对顺序；新增元素追加在末尾。
  const survivorSeq = (entries: ArrayEntry[]) =>
    entries.map((e) => e.key).filter((k) => nodes.has(k));
  const baseSeq = survivorSeq(bEntries);
  const localSeq = survivorSeq(lEntries);
  const remoteSeq = survivorSeq(rEntries);
  const inBase = (seq: string[]) => seq.filter((k) => bMap.has(k));
  const bBase = inBase(baseSeq);
  const lBase = inBase(localSeq);
  const rBase = inBase(remoteSeq);
  const eq = (a: string[], b: string[]) => a.length === b.length && a.every((k, i) => k === b[i]);

  let order: string[];
  let orderConflict: OrderConflict | undefined;
  if (eq(lBase, bBase) && eq(rBase, bBase)) {
    order = baseSeq;
  } else if (eq(lBase, rBase)) {
    order = localSeq; // 双方重排一致
  } else if (eq(lBase, bBase)) {
    order = remoteSeq; // 仅 remote 重排
  } else if (eq(rBase, bBase)) {
    order = localSeq; // 仅 local 重排
  } else if (byId) {
    // 双方重排不一致 → 顺序冲突（仅 id 数组有意义；位置数组顺序即内容）
    order = baseSeq;
    orderConflict = {
      id: orderConflictId(path),
      path,
      base: sideOf(base),
      local: sideOf(local),
      remote: sideOf(remote),
    };
  } else {
    order = baseSeq;
  }

  // 追加任一方新增、尚未进入顺序的键（local 优先，保持各自相对顺序）
  for (const k of [...localSeq, ...remoteSeq]) {
    if (!order.includes(k)) order.push(k);
  }
  const items = order.filter((k) => nodes.has(k)).map((k) => nodes.get(k)!);
  return { kind: 'array', items, ...(orderConflict ? { orderConflict } : {}) };
}

/* ------------------------------------------------------------------ */
/* 冲突收集                                                            */
/* ------------------------------------------------------------------ */

function collectConflicts(node: MergeNode, out: ConflictInfo[]): void {
  switch (node.kind) {
    case 'conflict':
      out.push({
        id: node.id,
        path: node.path,
        pathDisplay: formatPath(node.path),
        kind: node.conflictKind,
        base: node.base,
        local: node.local,
        remote: node.remote,
      });
      return;
    case 'object':
      for (const k of Object.keys(node.children)) collectConflicts(node.children[k], out);
      return;
    case 'array':
      if (node.orderConflict) {
        out.push({
          id: node.orderConflict.id,
          path: node.orderConflict.path,
          pathDisplay: `${formatPath(node.orderConflict.path)} (元素顺序)`,
          kind: 'array-order',
          base: node.orderConflict.base,
          local: node.orderConflict.local,
          remote: node.orderConflict.remote,
        });
      }
      for (const item of node.items) collectConflicts(item.node, out);
      return;
  }
}

/* ------------------------------------------------------------------ */
/* 物化：应用决策得到最终文档                                          */
/* ------------------------------------------------------------------ */

export interface MaterializeResult {
  document: JSONValue;
  complete: boolean;
  unresolved: string[];
}

export function materialize(root: MergeNode, decisions: DecisionMap): MaterializeResult {
  const unresolved: string[] = [];
  const side = materializeNode(root, decisions, unresolved);
  return {
    document: side.present ? side.value! : null,
    complete: unresolved.length === 0,
    unresolved,
  };
}

function materializeNode(node: MergeNode, decisions: DecisionMap, unresolved: string[]): Side {
  switch (node.kind) {
    case 'value':
      return sideOf(node.value);
    case 'conflict': {
      const pick = decisions[node.id];
      if (!pick) {
        unresolved.push(node.id);
        return node.base; // 未决策时以 base 占位
      }
      return node[pick];
    }
    case 'object': {
      const out: JSONObject = {};
      for (const k of Object.keys(node.children)) {
        const s = materializeNode(node.children[k], decisions, unresolved);
        if (s.present) out[k] = s.value!;
      }
      return sideOf(out);
    }
    case 'array': {
      let order = node.items.map((it) => it.key);
      if (node.orderConflict) {
        const oc = node.orderConflict;
        const pick = decisions[oc.id];
        if (!pick) {
          unresolved.push(oc.id);
        } else {
          const chosen = oc[pick];
          if (chosen.present && Array.isArray(chosen.value)) {
            const chosenKeys = (chosen.value as JSONValue[])
              .filter((el) => isPlainObject(el) && el.id !== undefined)
              .map((el) => `id:${String((el as JSONObject).id)}`);
            // 保留被选中方的顺序；该方没有的键（如另一方新增的元素）追加在后
            const rest = order.filter((k) => !chosenKeys.includes(k));
            order = [...chosenKeys.filter((k) => node.items.some((it) => it.key === k)), ...rest];
          }
        }
      }
      const byKey = new Map(node.items.map((it) => [it.key, it]));
      const out: JSONValue[] = [];
      for (const key of order) {
        const item = byKey.get(key);
        if (!item) continue;
        const s = materializeNode(item.node, decisions, unresolved);
        if (s.present) out.push(s.value!);
      }
      return sideOf(out);
    }
  }
}

/* ------------------------------------------------------------------ */
/* 冲突元信息（供 UI 展示类型变化等）                                   */
/* ------------------------------------------------------------------ */

export function describeSide(s: Side): string {
  if (!s.present) return '(不存在)';
  return jsonType(s.value);
}
