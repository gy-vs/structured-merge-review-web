import express, { type Express } from 'express';
import type { SessionStore } from './storage';

function isJSONValue(v: unknown): boolean {
  if (v === null) return true;
  const t = typeof v;
  if (t === 'boolean' || t === 'number' || t === 'string') return true;
  if (Array.isArray(v)) return v.every(isJSONValue);
  if (t === 'object') return Object.values(v as object).every(isJSONValue);
  return false;
}

export function createApp(store: SessionStore): Express {
  const app = express();
  app.use(express.json({ limit: '25mb' }));

  app.post('/api/sessions', async (req, res) => {
    const { name, base, local, remote } = req.body ?? {};
    if (!isJSONValue(base) || !isJSONValue(local) || !isJSONValue(remote)) {
      res.status(400).json({ error: 'base/local/remote 必须是合法 JSON 值' });
      return;
    }
    const record = await store.create({
      name: typeof name === 'string' && name.trim() ? name.trim() : '未命名会话',
      base,
      local,
      remote,
    });
    res.status(201).json(record);
  });

  app.get('/api/sessions', async (_req, res) => {
    res.json(await store.list());
  });

  app.get('/api/sessions/:id', async (req, res) => {
    const record = await store.get(req.params.id);
    if (!record) {
      res.status(404).json({ error: '会话不存在' });
      return;
    }
    res.json(record);
  });

  app.put('/api/sessions/:id', async (req, res) => {
    const { revision, decisions, name } = req.body ?? {};
    if (typeof revision !== 'number') {
      res.status(400).json({ error: '缺少 revision' });
      return;
    }
    if (decisions !== undefined && (typeof decisions !== 'object' || decisions === null)) {
      res.status(400).json({ error: 'decisions 必须是对象' });
      return;
    }
    const result = await store.update(req.params.id, revision, { decisions, name });
    if (!result.ok) {
      if (result.reason === 'not-found') {
        res.status(404).json({ error: '会话不存在' });
      } else {
        // 409 + 当前记录：客户端据此合并决策并重试，而不是最后写入覆盖
        res.status(409).json({ error: 'revision-conflict', current: result.current });
      }
      return;
    }
    res.json(result.record);
  });

  return app;
}
