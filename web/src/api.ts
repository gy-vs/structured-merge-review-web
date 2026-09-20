import type { Decisions, SessionRecord, SessionSummary } from '../../shared/types';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: { 'content-type': 'application/json' },
    ...init,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    if (res.status === 409) {
      throw new SaveConflictError((body as { current: SessionRecord }).current);
    }
    throw new Error((body as { error?: string }).error ?? `请求失败（${res.status}）`);
  }
  return (await res.json()) as T;
}

export class SaveConflictError extends Error {
  constructor(public current: SessionRecord) {
    super('会话已在别处被修改');
    this.name = 'SaveConflictError';
  }
}

export function listSessions(): Promise<SessionSummary[]> {
  return request<SessionSummary[]>('/api/sessions');
}

export function createSession(input: {
  name: string;
  base: unknown;
  local: unknown;
  remote: unknown;
}): Promise<SessionRecord> {
  return request<SessionRecord>('/api/sessions', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function getSession(id: string): Promise<SessionRecord> {
  return request<SessionRecord>(`/api/sessions/${id}`);
}

export function saveDecisions(
  id: string,
  revision: number,
  decisions: Decisions,
): Promise<SessionRecord> {
  return request<SessionRecord>(`/api/sessions/${id}`, {
    method: 'PUT',
    body: JSON.stringify({ revision, decisions }),
  });
}
