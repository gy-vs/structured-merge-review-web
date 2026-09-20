import type { DecisionMap, JSONValue } from '../../shared/merge.js';
import type { SaveResponse, SessionDTO, SessionSummary } from '../../shared/api.js';

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok && res.status !== 409) {
    throw new Error((body as { error?: string }).error ?? `请求失败 (${res.status})`);
  }
  return body as T;
}

export const api = {
  listSessions: () => request<SessionSummary[]>('/api/sessions'),

  createSession: (name: string, base: JSONValue, local: JSONValue, remote: JSONValue) =>
    request<SessionDTO>('/api/sessions', {
      method: 'POST',
      body: JSON.stringify({ name, base, local, remote }),
    }),

  getSession: (id: string) => request<SessionDTO>(`/api/sessions/${id}`),

  saveDecisions: async (id: string, revision: number, decisions: DecisionMap): Promise<SaveResponse> => {
    const res = await fetch(`/api/sessions/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ revision, decisions }),
    });
    const body = await res.json();
    if (res.status === 409) {
      return { status: 'conflict', revision: body.revision, decisions: body.decisions };
    }
    if (!res.ok) throw new Error(body.error ?? `保存失败 (${res.status})`);
    return { status: 'ok', revision: body.revision, decisions: body.decisions };
  },
};
