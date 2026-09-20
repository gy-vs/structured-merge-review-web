import { useEffect, useState } from 'react';
import { api } from '../api';
import type { SessionSummary } from '../../../shared/api.js';
import type { JSONValue } from '../../../shared/merge.js';

const SAMPLE = {
  base: {
    app: 'demo',
    version: 1,
    server: { host: 'example.com', port: 80, tls: false },
    features: [
      { id: 'search', enabled: true, weight: 1 },
      { id: 'cart', enabled: true, weight: 2 },
      { id: 'checkout', enabled: false, weight: 3 },
    ],
    legacy: { keep: 'me' },
  },
  local: {
    app: 'demo',
    version: 2,
    server: { host: 'local.dev', port: 8080 },
    features: [
      { id: 'checkout', enabled: true, weight: 3 },
      { id: 'search', enabled: true, weight: 5 },
      { id: 'cart', enabled: true, weight: 2 },
    ],
  },
  remote: {
    app: 'demo',
    version: 3,
    server: { host: 'example.com', port: 443, tls: true },
    features: [
      { id: 'search', enabled: false, weight: 1 },
      { id: 'cart', enabled: true, weight: 9 },
      { id: 'checkout', enabled: false, weight: 3 },
      { id: 'gift', enabled: true, weight: 4 },
    ],
    legacy: { keep: 'me', extra: 'remote' },
  },
};

type PanelState = { text: string; error: string | null };

const toPanel = (v: JSONValue): PanelState => ({ text: JSON.stringify(v, null, 2), error: null });

export default function Home() {
  const [name, setName] = useState('示例合并会话');
  const [base, setBase] = useState<PanelState>(() => toPanel(SAMPLE.base));
  const [local, setLocal] = useState<PanelState>(() => toPanel(SAMPLE.local));
  const [remote, setRemote] = useState<PanelState>(() => toPanel(SAMPLE.remote));
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.listSessions().then(setSessions).catch(() => setSessions([]));
  }, []);

  const parse = (p: PanelState): JSONValue | null => {
    try {
      return JSON.parse(p.text) as JSONValue;
    } catch {
      return null;
    }
  };

  const create = async () => {
    const b = parse(base), l = parse(local), r = parse(remote);
    if (b === null || l === null || r === null) {
      setError('存在无法解析的 JSON，请检查输入。');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const s = await api.createSession(name, b, l, r);
      window.location.hash = `#/session/${encodeURIComponent(s.id)}`;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const panel = (
    label: string,
    state: PanelState,
    setState: (p: PanelState) => void,
  ) => (
    <label className="json-panel">
      <span className="json-panel-label">{label}</span>
      <textarea
        spellCheck={false}
        value={state.text}
        onChange={(e) => {
          const text = e.target.value;
          let errorMsg: string | null = null;
          try {
            JSON.parse(text);
          } catch (err) {
            errorMsg = err instanceof Error ? err.message : 'JSON 解析失败';
          }
          setState({ text, error: errorMsg });
        }}
      />
      {state.error && <span className="json-panel-error">{state.error}</span>}
    </label>
  );

  return (
    <div className="home">
      <header className="home-header">
        <h1>三方合并工作台</h1>
        <p>输入基线（base）、本地（local）与远端（remote）三份 JSON，自动合并不冲突的改动，冲突逐项审阅。</p>
      </header>

      <div className="home-name">
        <label>
          会话名称
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <button
          type="button"
          onClick={() => {
            setBase(toPanel(SAMPLE.base));
            setLocal(toPanel(SAMPLE.local));
            setRemote(toPanel(SAMPLE.remote));
          }}
        >
          载入示例
        </button>
      </div>

      <div className="home-panels">
        {panel('基线 base', base, setBase)}
        {panel('本地 local', local, setLocal)}
        {panel('远端 remote', remote, setRemote)}
      </div>

      {error && <p className="error-banner">{error}</p>}

      <button className="primary" disabled={busy} onClick={create}>
        {busy ? '创建中…' : '开始合并审阅'}
      </button>

      {sessions.length > 0 && (
        <section className="session-list">
          <h2>继续之前的会话</h2>
          <ul>
            {sessions.map((s) => (
              <li key={s.id}>
                <a href={`#/session/${encodeURIComponent(s.id)}`}>{s.name}</a>
                <span className="muted">
                  已决策 {s.decisionCount} 项 · 更新于 {new Date(s.updatedAt).toLocaleString()}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
