import { describe, expect, it } from 'vitest';
import { merge } from '../shared/merge';

describe('三方合并：无冲突自动合并', () => {
  it('两侧改不同字段时自动合并', () => {
    const base = { a: 1, b: 2, c: 3 };
    const local = { a: 10, b: 2, c: 3 };
    const remote = { a: 1, b: 20, c: 3 };
    const r = merge(base, local, remote);
    expect(r.conflicts).toHaveLength(0);
    expect(r.merged).toEqual({ a: 10, b: 20, c: 3 });
  });

  it('单边新增与单边删除字段自动合并', () => {
    const base = { keep: 1, drop: 2 };
    const local = { keep: 1, added: 'x' } as const; // 删了 drop，加了 added
    const remote = { keep: 1, drop: 2 };
    const r = merge(base, local as never, remote as never);
    expect(r.conflicts).toHaveLength(0);
    expect(r.merged).toEqual({ keep: 1, added: 'x' });
  });

  it('两侧新增同一字段且值相同 → 不冲突', () => {
    const r = merge({ a: 1 }, { a: 1, n: 5 }, { a: 1, n: 5 });
    expect(r.conflicts).toHaveLength(0);
    expect(r.merged).toEqual({ a: 1, n: 5 });
  });

  it('两侧都删除同一字段 → 删除，不冲突', () => {
    const r = merge({ a: 1, b: 2 }, { a: 1 } as never, { a: 1 } as never);
    expect(r.conflicts).toHaveLength(0);
    expect(r.merged).toEqual({ a: 1 });
  });
});

describe('三方合并：嵌套冲突', () => {
  const base = { user: { name: 'ada', age: 30 }, meta: { v: 1 } };
  const local = { user: { name: 'ada-lovelace', age: 31 }, meta: { v: 1 } };
  const remote = { user: { name: 'ada-byron', age: 30 }, meta: { v: 2 } };

  it('同名字段被改成不同值 → value 冲突，路径正确', () => {
    const r = merge(base, local, remote);
    expect(r.conflicts).toHaveLength(1);
    const c = r.conflicts[0];
    expect(c.kind).toBe('value');
    expect(c.path).toBe('/user/name');
    expect(c.base).toBe('ada');
    expect(c.local).toBe('ada-lovelace');
    expect(c.remote).toBe('ada-byron');
    // 未裁决时默认 local
    expect((r.merged as never as typeof local).user.name).toBe('ada-lovelace');
  });

  it('冲突外的字段照常自动合并', () => {
    const r = merge(base, local, remote);
    const m = r.merged as never as typeof local;
    expect(m.user.age).toBe(31); // 本地改的
    expect(m.meta.v).toBe(2); // 远端改的
  });

  it('裁决为 remote 后结果采用远端值', () => {
    const first = merge(base, local, remote);
    const id = first.conflicts[0].id;
    const r = merge(base, local, remote, { [id]: 'remote' });
    expect((r.merged as never as typeof local).user.name).toBe('ada-byron');
  });

  it('冲突 id 在多次合并间稳定（可用于恢复会话）', () => {
    expect(merge(base, local, remote).conflicts[0].id).toBe(
      merge(base, local, remote).conflicts[0].id,
    );
  });
});

describe('三方合并：数组按稳定 id 对齐', () => {
  const base = {
    items: [
      { id: 1, v: 'a' },
      { id: 2, v: 'b' },
      { id: 3, v: 'c' },
    ],
  };

  it('一侧重排、另一侧改元素 → 自动合并，顺序取重排侧', () => {
    const local = { items: [{ id: 3, v: 'c' }, { id: 1, v: 'a' }, { id: 2, v: 'b' }] };
    const remote = { items: [{ id: 1, v: 'a' }, { id: 2, v: 'B' }, { id: 3, v: 'c' }] };
    const r = merge(base, local, remote);
    expect(r.conflicts).toHaveLength(0);
    expect(r.merged).toEqual({
      items: [
        { id: 3, v: 'c' },
        { id: 1, v: 'a' },
        { id: 2, v: 'B' },
      ],
    });
  });

  it('一侧删除元素、另一侧新增元素 → 自动合并', () => {
    const local = { items: [{ id: 1, v: 'a' }, { id: 3, v: 'c' }] }; // 删 id=2
    const remote = {
      items: [
        { id: 1, v: 'a' },
        { id: 2, v: 'b' },
        { id: 3, v: 'c' },
        { id: 4, v: 'd' },
      ],
    };
    const r = merge(base, local, remote);
    expect(r.conflicts).toHaveLength(0);
    expect(r.merged).toEqual({
      items: [
        { id: 1, v: 'a' },
        { id: 3, v: 'c' },
        { id: 4, v: 'd' },
      ],
    });
  });

  it('同一元素被两侧改成不同值 → 元素级冲突，路径含稳定 id', () => {
    const local = { items: [{ id: 1, v: 'x' }, { id: 2, v: 'b' }, { id: 3, v: 'c' }] };
    const remote = { items: [{ id: 1, v: 'y' }, { id: 2, v: 'b' }, { id: 3, v: 'c' }] };
    const r = merge(base, local, remote);
    expect(r.conflicts).toHaveLength(1);
    expect(r.conflicts[0].path).toBe('/items[id=1]/v');
  });

  it('一侧删除元素、另一侧修改该元素 → delete-edit 冲突', () => {
    const local = { items: [{ id: 1, v: 'a' }, { id: 3, v: 'c' }] };
    const remote = { items: [{ id: 1, v: 'a' }, { id: 2, v: 'B' }, { id: 3, v: 'c' }] };
    const r = merge(base, local, remote);
    expect(r.conflicts).toHaveLength(1);
    expect(r.conflicts[0].kind).toBe('delete-edit');
    expect(r.conflicts[0].path).toBe('/items[id=2]');
    expect(r.conflicts[0].deletedSide).toBe('local');
  });
});

describe('三方合并：父节点删除与子节点修改', () => {
  const base = { section: { x: 1, y: 2 }, other: true };
  const local = { other: true } as never; // 整个 section 被本地删除
  const remote = { section: { x: 9, y: 2 }, other: true };

  it('产生 delete-edit 冲突', () => {
    const r = merge(base, local, remote);
    expect(r.conflicts).toHaveLength(1);
    const c = r.conflicts[0];
    expect(c.kind).toBe('delete-edit');
    expect(c.path).toBe('/section');
    expect(c.deletedSide).toBe('local');
    expect(c.hasLocal).toBe(false);
  });

  it('选择 local → 删除该子树；选择 remote → 保留远端修改', () => {
    const id = merge(base, local, remote).conflicts[0].id;
    const keepLocal = merge(base, local, remote, { [id]: 'local' });
    expect(keepLocal.merged).toEqual({ other: true });
    const keepRemote = merge(base, local, remote, { [id]: 'remote' });
    expect(keepRemote.merged).toEqual(remote);
  });
});

describe('三方合并：类型变化', () => {
  it('同一路径两侧变成不同类型 → type 冲突', () => {
    const base = { v: { nested: 1 } };
    const local = { v: 5 } as never;
    const remote = { v: { nested: 2 } } as never;
    const r = merge(base, local, remote);
    expect(r.conflicts).toHaveLength(1);
    expect(r.conflicts[0].kind).toBe('type');
    expect(r.conflicts[0].path).toBe('/v');
  });

  it('对象 ↔ 数组变化也是 type 冲突', () => {
    const r = merge({ v: [1] }, { v: { a: 1 } } as never, { v: [1, 2] } as never);
    expect(r.conflicts).toHaveLength(1);
    expect(r.conflicts[0].kind).toBe('type');
  });

  it('两侧都新增同一路径但内容不同 → add-add 冲突', () => {
    const r = merge({ a: 1 }, { a: 1, n: 'left' }, { a: 1, n: 'right' });
    expect(r.conflicts).toHaveLength(1);
    expect(r.conflicts[0].kind).toBe('add-add');
    expect(r.conflicts[0].hasBase).toBe(false);
  });
});

describe('三方合并：标量值冲突与裁决', () => {
  const base = { title: 'draft' };
  const local = { title: 'local-title' };
  const remote = { title: 'remote-title' };

  it('base 裁决可恢复基线值', () => {
    const id = merge(base, local, remote).conflicts[0].id;
    const r = merge(base, local, remote, { [id]: 'base' });
    expect(r.merged).toEqual({ title: 'draft' });
  });
});
