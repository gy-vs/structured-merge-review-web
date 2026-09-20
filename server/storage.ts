import { randomUUID } from 'node:crypto';
import type { Decisions, JSONValue, SessionRecord, SessionSummary } from '../shared/types';

export interface CreateSessionInput {
  name: string;
  base: JSONValue;
  local: JSONValue;
  remote: JSONValue;
}

export interface UpdateSessionInput {
  decisions?: Decisions;
  name?: string;
}

export type UpdateResult =
  | { ok: true; record: SessionRecord }
  | { ok: false; reason: 'not-found' }
  | { ok: false; reason: 'revision-conflict'; current: SessionRecord };

/**
 * 可注入的会话存储接口。默认提供进程内实现；
 * 测试或未来接入真实数据库时替换实现即可，路由层不感知。
 */
export interface SessionStore {
  create(input: CreateSessionInput): Promise<SessionRecord>;
  get(id: string): Promise<SessionRecord | undefined>;
  list(): Promise<SessionSummary[]>;
  /**
   * 乐观并发：仅当 expectedRevision 与当前 revision 一致时写入，
   * 否则返回 revision-conflict 与当前记录，绝不静默覆盖。
   */
  update(id: string, expectedRevision: number, patch: UpdateSessionInput): Promise<UpdateResult>;
}

export class InMemorySessionStore implements SessionStore {
  private sessions = new Map<string, SessionRecord>();

  async create(input: CreateSessionInput): Promise<SessionRecord> {
    const now = new Date().toISOString();
    const record: SessionRecord = {
      id: randomUUID(),
      name: input.name,
      revision: 1,
      base: input.base,
      local: input.local,
      remote: input.remote,
      decisions: {},
      createdAt: now,
      updatedAt: now,
    };
    this.sessions.set(record.id, record);
    return structuredClone(record);
  }

  async get(id: string): Promise<SessionRecord | undefined> {
    const found = this.sessions.get(id);
    return found ? structuredClone(found) : undefined;
  }

  async list(): Promise<SessionSummary[]> {
    return [...this.sessions.values()]
      .map(({ id, name, revision, updatedAt }) => ({ id, name, revision, updatedAt }))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async update(
    id: string,
    expectedRevision: number,
    patch: UpdateSessionInput,
  ): Promise<UpdateResult> {
    const current = this.sessions.get(id);
    if (!current) return { ok: false, reason: 'not-found' };
    if (current.revision !== expectedRevision) {
      return { ok: false, reason: 'revision-conflict', current: structuredClone(current) };
    }
    const next: SessionRecord = {
      ...current,
      decisions: patch.decisions ?? current.decisions,
      name: patch.name ?? current.name,
      revision: current.revision + 1,
      updatedAt: new Date().toISOString(),
    };
    this.sessions.set(id, next);
    return { ok: true, record: structuredClone(next) };
  }
}
