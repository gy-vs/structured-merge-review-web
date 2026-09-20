import type {
  Choice,
  Conflict,
  ConflictKind,
  Decisions,
  JSONValue,
  MergeResult,
} from './types';

/**
 * 三方合并引擎。
 *
 * 语义：
 * - 一侧未动 → 采用另一侧（涵盖单边新增 / 删除 / 修改）。
 * - 对象按字段递归合并；数组按元素稳定 `id` 对齐，无 id 的元素按序号对齐。
 * - 一侧删除父节点而另一侧修改其子节点 → delete-edit 冲突。
 * - 同一路径两侧类型不同 → type 冲突；两侧都新增同一路径且不同 → add-add 冲突。
 * - 冲突的取舍由 decisions（conflictId → Choice）决定，未裁决时默认 local，
 *   因此同一输入 + 同一 decisions 永远得到同一结果（可用于刷新后恢复）。
 */

const ABSENT: unique symbol = Symbol('absent');
type Slot = JSONValue | typeof ABSENT;

type Obj = Record<string, JSONValue>;

interface Ctx {
  decisions: Decisions;
  conflicts: Conflict[];
}

export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== typeof b) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((x, i) => deepEqual(x, b[i]));
  }
  if (typeof a === 'object') {
    const ka = Object.keys(a as Obj);
    const kb = Object.keys(b as Obj);
    if (ka.length !== kb.length) return false;
    return ka.every((k) => deepEqual((a as Obj)[k], (b as Obj)[k]));
  }
  return false;
}

function isObj(v: Slot): v is Obj {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function category(v: JSONValue): 'null' | 'array' | 'object' | 'primitive' {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (typeof v === 'object') return 'object';
  return 'primitive';
}

function eqSlot(a: Slot, b: Slot): boolean {
  if (a === ABSENT || b === ABSENT) return a === b;
  return deepEqual(a, b);
}

function slotOf(obj: Slot, key: string): Slot {
  return isObj(obj) && Object.prototype.hasOwnProperty.call(obj, key)
    ? obj[key]
    : ABSENT;
}

function pick(choice: Choice, b: Slot, l: Slot, r: Slot): Slot {
  return choice === 'local' ? l : choice === 'remote' ? r : b;
}

function makeConflict(
  kind: ConflictKind,
  path: string,
  b: Slot,
  l: Slot,
  r: Slot,
  deletedSide?: 'local' | 'remote',
): Conflict {
  const c: Conflict = {
    id: `${kind}:${path || '/'}`,
    path: path || '/',
    kind,
    hasBase: b !== ABSENT,
    hasLocal: l !== ABSENT,
    hasRemote: r !== ABSENT,
  };
  if (deletedSide) c.deletedSide = deletedSide;
  if (b !== ABSENT) c.base = b;
  if (l !== ABSENT) c.local = l;
  if (r !== ABSENT) c.remote = r;
  return c;
}

function mergeNode(b: Slot, l: Slot, r: Slot, path: string, ctx: Ctx): Slot {
  // 两侧一致（含都不存在）
  if (eqSlot(l, r)) return l;
  // 本地未动 → 远端；远端未动 → 本地。ABSENT 参与比较，天然覆盖单边增删。
  if (eqSlot(b, l)) return r;
  if (eqSlot(b, r)) return l;

  // 一侧删除、另一侧修改（含父删子改：子树整体作为一侧的值）
  if (l === ABSENT || r === ABSENT) {
    const deletedSide = l === ABSENT ? 'local' : 'remote';
    const c = makeConflict('delete-edit', path, b, l, r, deletedSide);
    ctx.conflicts.push(c);
    return pick(ctx.decisions[c.id] ?? 'local', b, l, r);
  }

  // 两侧都是对象 → 按字段递归（base 非对象时视为全空，逐字段按新增处理）
  if (isObj(l) && isObj(r)) return mergeObject(b, l, r, path, ctx);
  // 两侧都是数组 → 按稳定 id 对齐
  if (Array.isArray(l) && Array.isArray(r)) return mergeArray(b, l, r, path, ctx);

  const kind: ConflictKind =
    b === ABSENT
      ? 'add-add'
      : category(l as JSONValue) !== category(r as JSONValue) ||
          category(l as JSONValue) !== category(b) ||
          category(r as JSONValue) !== category(b)
        ? 'type'
        : 'value';
  const c = makeConflict(kind, path, b, l, r);
  ctx.conflicts.push(c);
  return pick(ctx.decisions[c.id] ?? 'local', b, l, r);
}

function mergeObject(b: Slot, l: Slot, r: Slot, path: string, ctx: Ctx): Slot {
  const out: Obj = {};
  const keys: string[] = [];
  const sides: Slot[] = [b, l, r];
  for (const side of sides) {
    if (isObj(side)) {
      for (const k of Object.keys(side)) {
        if (!keys.includes(k)) keys.push(k);
      }
    }
  }
  for (const k of keys) {
    const child = mergeNode(slotOf(b, k), slotOf(l, k), slotOf(r, k), `${path}/${k}`, ctx);
    if (child !== ABSENT) out[k] = child;
  }
  return out;
}

/** 数组元素的稳定身份：对象元素取 `id` 字段，其余视为无 id */
function arrKey(el: JSONValue): string | null {
  if (isObj(el)) {
    const id = (el as Obj).id;
    if (typeof id === 'string' || typeof id === 'number') return String(id);
  }
  return null;
}

function arrEq(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

function mergeArray(b: Slot, l: Slot, r: Slot, path: string, ctx: Ctx): Slot {
  const keyedOf = (arr: Slot): Map<string, JSONValue> => {
    const m = new Map<string, JSONValue>();
    if (Array.isArray(arr)) {
      for (const el of arr) {
        const k = arrKey(el);
        if (k !== null && !m.has(k)) m.set(k, el);
      }
    }
    return m;
  };
  const unkeyedOf = (arr: Slot): JSONValue[] =>
    Array.isArray(arr) ? arr.filter((el) => arrKey(el) === null) : [];

  const bm = keyedOf(b);
  const lm = keyedOf(l);
  const rm = keyedOf(r);
  const bu = unkeyedOf(b);
  const lu = unkeyedOf(l);
  const ru = unkeyedOf(r);

  // 键的并集，顺序：基线 → 本地新增 → 远端新增
  const union: string[] = [];
  for (const m of [bm, lm, rm]) {
    for (const k of m.keys()) if (!union.includes(k)) union.push(k);
  }

  const mergedByKey = new Map<string, Slot>();
  for (const k of union) {
    mergedByKey.set(
      k,
      mergeNode(
        bm.get(k) ?? ABSENT,
        lm.get(k) ?? ABSENT,
        rm.get(k) ?? ABSENT,
        `${path}[id=${k}]`,
        ctx,
      ),
    );
  }

  // 无 id 元素按序号对齐
  const unLen = Math.max(bu.length, lu.length, ru.length);
  const mergedUnkeyed: Slot[] = [];
  for (let i = 0; i < unLen; i++) {
    mergedUnkeyed.push(
      mergeNode(bu[i] ?? ABSENT, lu[i] ?? ABSENT, ru[i] ?? ABSENT, `${path}[#${i}]`, ctx),
    );
  }

  // 顺序：采用相对基线改变了顺序的一侧；仅重排不构成冲突
  const survivors = union.filter((k) => mergedByKey.get(k) !== ABSENT);
  const orderOf = (m: Map<string, JSONValue>) =>
    [...m.keys()].filter((k) => survivors.includes(k));
  const bOrd = orderOf(bm);
  const lOrd = orderOf(lm);
  const rOrd = orderOf(rm);
  const lChanged = !arrEq(lOrd, bOrd);
  const rChanged = !arrEq(rOrd, bOrd);

  if (lChanged && rChanged && !arrEq(lOrd, rOrd)) {
    // 两侧以不同方式重排：整组数组作为一个冲突交给用户
    const c = makeConflict('array-order', path, b, l, r);
    ctx.conflicts.push(c);
    return pick(ctx.decisions[c.id] ?? 'local', b, l, r);
  }

  const chosen = lChanged ? [...lOrd] : rChanged ? [...rOrd] : [...bOrd];
  for (const k of survivors) if (!chosen.includes(k)) chosen.push(k);

  const out: JSONValue[] = [];
  for (const k of chosen) out.push(mergedByKey.get(k) as JSONValue);
  for (const s of mergedUnkeyed) if (s !== ABSENT) out.push(s);
  return out;
}

export function merge(
  base: JSONValue,
  local: JSONValue,
  remote: JSONValue,
  decisions: Decisions = {},
): MergeResult {
  const ctx: Ctx = { decisions, conflicts: [] };
  const root = mergeNode(base, local, remote, '', ctx);
  return { merged: root === ABSENT ? null : root, conflicts: ctx.conflicts };
}
