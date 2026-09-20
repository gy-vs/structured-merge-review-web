import express, { type Express } from 'express';
import { mergeDocuments, type DecisionMap, type JSONValue } from '../shared/merge.js';
import type { SessionRecord, SessionStore } from './storage.js';

/** 冲突列表与合并树由输入确定性推导，不持久化，响应时现算。 */
function toDTO(session: SessionRecord) {
  const { root, conflicts } = mergeDocuments(
    session.inputs.base,
    session.inputs.local,
    session.inputs.remote,
  );
  return {
    id: session.id,
    name: session.name,
    revision: session.revision,
    decisions: session.decisions,
    conflicts,
    tree: root,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
  };
}

function isJSONValue(v: unknown): v is JSONValue {
  if (v === null) return true;
  switch (typeof v) {
    case 'string':
    case 'number':
    case 'boolean':
      return true;
    case 'object':
      if (Array.isArray(v)) return v.every(isJSONValue);
      return Object.values(v as object).every(isJSONValue);
    default:
      return false;
  }
}

export function createApp(store: SessionStore): Express {
  const app = express();
  app.use(express.json({ limit: '10mb' }));

  app.post('/api/sessions', (req, res) => {
    const { name, base, local, remote } = req.body ?? {};
    if (!isJSONValue(base) || !isJSONValue(local) || !isJSONValue(remote)) {
      res.status(400).json({ error: 'base / local / remote 必须是合法 JSON 值' });
      return;
    }
    const record = store.create(
      typeof name === 'string' && name.trim() ? name.trim() : '未命名会话',
      { base, local, remote },
    );
    res.status(201).json(toDTO(record));
  });

  app.get('/api/sessions', (_req, res) => {
    res.json(
      store.list().map((s) => ({
        id: s.id,
        name: s.name,
        revision: s.revision,
        decisionCount: Object.keys(s.decisions).length,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
      })),
    );
  });

  app.get('/api/sessions/:id', (req, res) => {
    const s = store.get(req.params.id);
    if (!s) {
      res.status(404).json({ error: '会话不存在' });
      return;
    }
    res.json(toDTO(s));
  });

  app.put('/api/sessions/:id', (req, res) => {
    const { revision, decisions } = req.body ?? {};
    if (typeof revision !== 'number' || decisions === null || typeof decisions !== 'object') {
      res.status(400).json({ error: '需要 revision (number) 与 decisions (object)' });
      return;
    }
    const result = store.saveDecisions(req.params.id, revision, decisions as DecisionMap);
    switch (result.status) {
      case 'ok':
        res.json({ revision: result.record.revision, decisions: result.record.decisions });
        return;
      case 'conflict':
        res
          .status(409)
          .json({ error: 'revision 冲突', revision: result.current.revision, decisions: result.current.decisions });
        return;
      case 'missing':
        res.status(404).json({ error: '会话不存在' });
        return;
    }
  });

  return app;
}
