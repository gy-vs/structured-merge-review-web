import { useEffect, useState } from 'react';
import type { SessionRecord, SessionSummary } from '../../../shared/types';
import { createSession, getSession, listSessions } from '../api';

const DEMO = {
  base: {
    title: '产品清单',
    owner: { name: '张三', email: 'zhang@example.com' },
    items: [
      { id: 1, name: '键盘', price: 199 },
      { id: 2, name: '鼠标', price: 99 },
      { id: 3, name: '显示器', price: 899 },
    ],
    archived: { note: '旧数据', keep: false },
  },
  local: {
    title: '产品清单（本地修订）',
    owner: { name: '张三', email: 'zhang@example.com' },
    items: [
      { id: 3, name: '显示器', price: 899 },
      { id: 1, name: '键盘', price: 179 },
      { id: 2, name: '鼠标', price: 99 },
    ],
  },
  remote: {
    title: '产品清单（远端）',
    owner: { name: '张三（远程）', email: 'zhang@example.com' },
    items: [
      { id: 1, name: '键盘', price: 199 },
      { id: 2, name: '鼠标', price: 129 },
      { id: 3, name: '显示器', price: 899 },
      { id: 4, name: '扩展坞', price: 499 },
    ],
    archived: { note: '旧数据（已核实）', keep: true },
  },
};

const LAST_KEY = 'merge-workbench:last-session';

function parseJson(text: string): { ok: true; value: unknown } | { ok: false; error: string } {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export function Home({ onOpen }: { onOpen: (s: SessionRecord) => void }) {
  const [name, setName] = useState('未命名合并');
  const [baseText, setBaseText] = useState('');
  const [localText, setLocalText] = useState('');
  const [remoteText, setRemoteText] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [lastId, setLastId] = useState<string | null>(null);

  useEffect(() => {
    listSessions().then(setSessions).catch(() => setSessions([]));
    setLastId(localStorage.getItem(LAST_KEY));
  }, []);

  const fillDemo = () => {
    setName('演示：产品清单');
    setBaseText(JSON.stringify(DEMO.base, null, 2));
    setLocalText(JSON.stringify(DEMO.local, null, 2));
    setRemoteText(JSON.stringify(DEMO.remote, null, 2));
    setError('');
  };

  const submit = async () => {
    const b = parseJson(baseText);
    const l = parseJson(localText);
    const r = parseJson(remoteText);
    if (!b.ok) return setError(`基线 JSON 解析失败：${b.error}`);
    if (!l.ok) return setError(`本地 JSON 解析失败：${l.error}`);
    if (!r.ok) return setError(`远端 JSON 解析失败：${r.error}`);
    setBusy(true);
    setError('');
    try {
      const session = await createSession({
        name: name.trim() || '未命名合并',
        base: b.value,
        local: l.value,
        remote: r.value,
      });
      localStorage.setItem(LAST_KEY, session.id);
      onOpen(session);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const resume = async (id: string) => {
    setBusy(true);
    setError('');
    try {
      const session = await getSession(id);
      localStorage.setItem(LAST_KEY, session.id);
      onOpen(session);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="home">
      <h1>三方合并工作台</h1>
      <p className="muted">
        粘贴基线、本地、远端三份 JSON。互不冲突的改动会自动合并，真正的冲突由你逐项裁决。
      </p>

      <div className="home-actions">
        <input
          className="name-input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="会话名称"
        />
        <button onClick={fillDemo}>填入演示数据</button>
        <button className="primary" disabled={busy} onClick={submit}>
          {busy ? '创建中…' : '开始合并'}
        </button>
      </div>
      {error && <div className="error-banner">{error}</div>}

      <div className="input-grid">
        <label>
          <span className="tone-tag tone-base">基线 base</span>
          <textarea
            value={baseText}
            onChange={(e) => setBaseText(e.target.value)}
            spellCheck={false}
            placeholder='{"a": 1}'
          />
        </label>
        <label>
          <span className="tone-tag tone-local">本地 local</span>
          <textarea
            value={localText}
            onChange={(e) => setLocalText(e.target.value)}
            spellCheck={false}
            placeholder='{"a": 2}'
          />
        </label>
        <label>
          <span className="tone-tag tone-remote">远端 remote</span>
          <textarea
            value={remoteText}
            onChange={(e) => setRemoteText(e.target.value)}
            spellCheck={false}
            placeholder='{"a": 1, "b": 3}'
          />
        </label>
      </div>

      {sessions.length > 0 && (
        <section className="session-list">
          <h2>恢复未完成的会话</h2>
          <ul>
            {sessions.map((s) => (
              <li key={s.id}>
                <button
                  className={`session-item ${s.id === lastId ? 'last' : ''}`}
                  disabled={busy}
                  onClick={() => resume(s.id)}
                >
                  <span className="session-name">{s.name}</span>
                  <span className="muted">
                    rev {s.revision} · {new Date(s.updatedAt).toLocaleString()}
                    {s.id === lastId ? ' · 上次编辑' : ''}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
