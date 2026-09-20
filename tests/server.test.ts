import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApp } from '../server/app';
import { InMemorySessionStore } from '../server/storage';
import type { SessionRecord } from '../shared/types';

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  // 每个测试进程使用独立的可注入存储实例
  const app = createApp(new InMemorySessionStore());
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => server.close());

async function api<T>(path: string, init?: RequestInit): Promise<{ status: number; body: T }> {
  const res = await fetch(`${baseUrl}${path}`, {
    headers: { 'content-type': 'application/json' },
    ...init,
  });
  return { status: res.status, body: (await res.json()) as T };
}

const sample = {
  base: { a: 1 },
  local: { a: 2 },
  remote: { a: 1, b: 3 },
};

describe('会话 API', () => {
  it('创建后可按 id 取回（刷新恢复）', async () => {
    const created = await api<SessionRecord>('/api/sessions', {
      method: 'POST',
      body: JSON.stringify({ name: 'demo', ...sample }),
    });
    expect(created.status).toBe(201);
    expect(created.body.revision).toBe(1);
    expect(created.body.decisions).toEqual({});

    const fetched = await api<SessionRecord>(`/api/sessions/${created.body.id}`);
    expect(fetched.status).toBe(200);
    expect(fetched.body.local).toEqual(sample.local);
  });

  it('保存决策推进 revision，之后可按原样取回', async () => {
    const created = (
      await api<SessionRecord>('/api/sessions', {
        method: 'POST',
        body: JSON.stringify({ name: 'resume', ...sample }),
      })
    ).body;

    const saved = await api<SessionRecord>(`/api/sessions/${created.id}`, {
      method: 'PUT',
      body: JSON.stringify({ revision: 1, decisions: { 'value:/a': 'local' } }),
    });
    expect(saved.status).toBe(200);
    expect(saved.body.revision).toBe(2);

    // 模拟刷新后恢复
    const restored = await api<SessionRecord>(`/api/sessions/${created.id}`);
    expect(restored.body.decisions).toEqual({ 'value:/a': 'local' });
    expect(restored.body.revision).toBe(2);
  });

  it('并发保存：过期 revision 收到 409，绝不最后写入覆盖', async () => {
    const created = (
      await api<SessionRecord>('/api/sessions', {
        method: 'POST',
        body: JSON.stringify({ name: 'race', ...sample }),
      })
    ).body;

    // 两个"页面"都拿着 revision=1
    const pageA = api<SessionRecord>(`/api/sessions/${created.id}`, {
      method: 'PUT',
      body: JSON.stringify({ revision: 1, decisions: { 'value:/a': 'local' } }),
    });
    const pageB = api<SessionRecord>(`/api/sessions/${created.id}`, {
      method: 'PUT',
      body: JSON.stringify({ revision: 1, decisions: { 'value:/a': 'remote' } }),
    });
    const [a, b] = await Promise.all([pageA, pageB]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([200, 409]);

    const loser = (a.status === 409 ? a : b).body as SessionRecord & {
      current?: SessionRecord;
    };
    expect(loser.current).toBeDefined();

    // 最终状态是胜者的决策，败者的写入没有覆盖它
    const final = await api<SessionRecord>(`/api/sessions/${created.id}`);
    expect(final.body.revision).toBe(2);
    expect(final.body.decisions).toEqual(
      (a.status === 200 ? a : b).body.decisions,
    );
  });

  it('409 响应携带当前记录，客户端可据此合并后重试成功', async () => {
    const created = (
      await api<SessionRecord>('/api/sessions', {
        method: 'POST',
        body: JSON.stringify({ name: 'retry', ...sample }),
      })
    ).body;
    await api(`/api/sessions/${created.id}`, {
      method: 'PUT',
      body: JSON.stringify({ revision: 1, decisions: { 'value:/a': 'local' } }),
    });
    // 过期写入 → 409
    const stale = await api<SessionRecord & { current: SessionRecord }>(
      `/api/sessions/${created.id}`,
      {
        method: 'PUT',
        body: JSON.stringify({ revision: 1, decisions: { 'value:/b': 'remote' } }),
      },
    );
    expect(stale.status).toBe(409);
    // 客户端合并双方决策后用新 revision 重试
    const merged = { ...stale.body.current.decisions, 'value:/b': 'remote' };
    const retry = await api<SessionRecord>(`/api/sessions/${created.id}`, {
      method: 'PUT',
      body: JSON.stringify({ revision: stale.body.current.revision, decisions: merged }),
    });
    expect(retry.status).toBe(200);
    expect(retry.body.decisions).toEqual({ 'value:/a': 'local', 'value:/b': 'remote' });
  });

  it('非法输入返回 400，未知会话返回 404', async () => {
    const bad = await api('/api/sessions', {
      method: 'POST',
      body: JSON.stringify({ name: 'x', base: 1, local: 2 }), // 缺 remote
    });
    expect(bad.status).toBe(400);
    const missing = await api('/api/sessions/does-not-exist');
    expect(missing.status).toBe(404);
  });
});
