import type { DecisionMap, JSONValue } from '../shared/merge.js';

export interface SessionInputs {
  base: JSONValue;
  local: JSONValue;
  remote: JSONValue;
}

export interface SessionRecord {
  id: string;
  name: string;
  /** 乐观并发控制：每次成功保存 +1，客户端必须带上自己看到的 revision */
  revision: number;
  inputs: SessionInputs;
  decisions: DecisionMap;
  createdAt: string;
  updatedAt: string;
}

export type SaveResult =
  | { status: 'ok'; record: SessionRecord }
  | { status: 'conflict'; current: SessionRecord }
  | { status: 'missing' };

/**
 * 可注入的存储接口。默认实现为进程内内存存储；
 * 测试或未来接入数据库时替换实现即可，路由层不感知。
 */
export interface SessionStore {
  create(name: string, inputs: SessionInputs): SessionRecord;
  get(id: string): SessionRecord | undefined;
  list(): SessionRecord[];
  /** 仅当 expectedRevision 与当前 revision 一致时写入，否则返回 conflict */
  saveDecisions(id: string, expectedRevision: number, decisions: DecisionMap): SaveResult;
}

const clone = <T>(v: T): T => structuredClone(v);

export class InMemorySessionStore implements SessionStore {
  private sessions = new Map<string, SessionRecord>();
  private seq = 0;

  create(name: string, inputs: SessionInputs): SessionRecord {
    const now = new Date().toISOString();
    const record: SessionRecord = {
      id: `s_${Date.now().toString(36)}_${++this.seq}`,
      name,
      revision: 0,
      inputs: clone(inputs),
      decisions: {},
      createdAt: now,
      updatedAt: now,
    };
    this.sessions.set(record.id, record);
    return clone(record);
  }

  get(id: string): SessionRecord | undefined {
    const s = this.sessions.get(id);
    return s ? clone(s) : undefined;
  }

  list(): SessionRecord[] {
    return [...this.sessions.values()]
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map(clone);
  }

  saveDecisions(id: string, expectedRevision: number, decisions: DecisionMap): SaveResult {
    const s = this.sessions.get(id);
    if (!s) return { status: 'missing' };
    if (s.revision !== expectedRevision) {
      return { status: 'conflict', current: clone(s) };
    }
    s.decisions = clone(decisions);
    s.revision += 1;
    s.updatedAt = new Date().toISOString();
    return { status: 'ok', record: clone(s) };
  }
}
