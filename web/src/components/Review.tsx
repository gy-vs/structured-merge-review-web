import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { merge } from '../../../shared/merge';
import type { Choice, Decisions, SessionRecord } from '../../../shared/types';
import { saveDecisions, SaveConflictError } from '../api';
import { ValueView } from './ValueView';

const KIND_LABEL: Record<string, string> = {
  value: '值冲突',
  type: '类型变化',
  'add-add': '双方新增',
  'delete-edit': '删除/修改',
  'array-order': '数组顺序',
};

type SaveStatus = 'saved' | 'saving' | 'error';

export function Review({
  session: initial,
  onBack,
}: {
  session: SessionRecord;
  onBack: () => void;
}) {
  const [session, setSession] = useState(initial);
  const [decisions, setDecisions] = useState<Decisions>(initial.decisions);
  const [past, setPast] = useState<Decisions[]>([]);
  const [future, setFuture] = useState<Decisions[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('saved');
  const [notice, setNotice] = useState('');

  // 合并结果（含裁决）——同一 decisions 下完全确定，刷新恢复后结果一致
  const result = useMemo(
    () => merge(session.base, session.local, session.remote, decisions),
    [session.base, session.local, session.remote, decisions],
  );
  const { conflicts, merged } = result;

  const selected = conflicts.find((c) => c.id === selectedId) ?? conflicts[0] ?? null;
  const decidedCount = conflicts.filter((c) => decisions[c.id] !== undefined).length;

  // ---- 自动保存（防抖 + 409 时合并双方决策重试，绝不静默覆盖）----
  const stateRef = useRef({ decisions, revision: session.revision });
  stateRef.current = { decisions, revision: session.revision };
  const savingRef = useRef(false);
  const dirtyRef = useRef(false);

  const persist = useCallback(async () => {
    if (savingRef.current) {
      dirtyRef.current = true;
      return;
    }
    savingRef.current = true;
    setSaveStatus('saving');
    try {
      const { decisions: d, revision } = stateRef.current;
      const saved = await saveDecisions(session.id, revision, d);
      setSession(saved);
      setSaveStatus('saved');
    } catch (e) {
      if (e instanceof SaveConflictError) {
        // 另一页面也改过：取服务器决策为底，叠加本地决策，再用新 revision 重试
        const server = e.current;
        setSession(server);
        setDecisions((prev) => ({ ...server.decisions, ...prev }));
        setNotice('检测到另一页面的修改，已合并双方决策');
      } else {
        setSaveStatus('error');
        setNotice(`保存失败：${(e as Error).message}`);
      }
    } finally {
      savingRef.current = false;
      if (dirtyRef.current) {
        dirtyRef.current = false;
        void persist();
      }
    }
  }, [session.id]);

  useEffect(() => {
    setSaveStatus('saving');
    const t = setTimeout(() => void persist(), 400);
    return () => clearTimeout(t);
  }, [decisions, persist]);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(''), 6000);
    return () => clearTimeout(t);
  }, [notice]);

  // ---- 撤销 / 重做 ----
  const applyDecisions = useCallback(
    (next: Decisions) => {
      setPast((p) => [...p.slice(-99), decisions]);
      setFuture([]);
      setDecisions(next);
    },
    [decisions],
  );

  const undo = useCallback(() => {
    if (past.length === 0) return;
    const prev = past[past.length - 1];
    setPast(past.slice(0, -1));
    setFuture([decisions, ...future]);
    setDecisions(prev);
  }, [past, future, decisions]);

  const redo = useCallback(() => {
    if (future.length === 0) return;
    const [next, ...rest] = future;
    setPast([...past, decisions]);
    setFuture(rest);
    setDecisions(next);
  }, [past, future, decisions]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      if (e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (e.key.toLowerCase() === 'y') {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo]);

  const decide = (id: string, choice: Choice) => {
    applyDecisions({ ...decisions, [id]: choice });
    // 裁决后自动跳到下一个未裁决冲突
    const idx = conflicts.findIndex((c) => c.id === id);
    const nextUndecided = conflicts.find(
      (c, i) => i > idx && decisions[c.id] === undefined,
    );
    if (nextUndecided) setSelectedId(nextUndecided.id);
  };

  const copyResult = () => {
    void navigator.clipboard?.writeText(JSON.stringify(merged, null, 2));
  };

  return (
    <div className="review">
      <header className="review-header">
        <button onClick={onBack}>← 返回</button>
        <h1>{session.name}</h1>
        <span className={`save-status save-${saveStatus}`}>
          {saveStatus === 'saving' ? '保存中…' : saveStatus === 'saved' ? `已保存 rev ${session.revision}` : '保存失败'}
        </span>
        <div className="header-spacer" />
        <span className="progress">
          已裁决 {decidedCount}/{conflicts.length}
        </span>
        <button disabled={past.length === 0} onClick={undo} title="Ctrl+Z">
          ↩ 撤销
        </button>
        <button disabled={future.length === 0} onClick={redo} title="Ctrl+Shift+Z">
          ↪ 重做
        </button>
      </header>

      {notice && <div className="notice-banner">{notice}</div>}

      {conflicts.length === 0 ? (
        <div className="all-clear">
          <h2>✅ 没有冲突，全部自动合并完成</h2>
          <p className="muted">下方是最终合并结果。</p>
        </div>
      ) : (
        <div className="review-body">
          <aside className="conflict-list">
            <h2>冲突（{conflicts.length}）</h2>
            <ul>
              {conflicts.map((c) => (
                <li key={c.id}>
                  <button
                    className={`conflict-item ${selected?.id === c.id ? 'active' : ''}`}
                    onClick={() => setSelectedId(c.id)}
                  >
                    <span className={`kind-badge kind-${c.kind}`}>{KIND_LABEL[c.kind]}</span>
                    <span className="conflict-path">{c.path}</span>
                    <span className="decided-mark">{decisions[c.id] ? '✓' : '○'}</span>
                  </button>
                </li>
              ))}
            </ul>
          </aside>

          {selected && (
            <main className="conflict-detail">
              <div className="detail-head">
                <code className="current-path">{selected.path}</code>
                <span className={`kind-badge kind-${selected.kind}`}>
                  {KIND_LABEL[selected.kind]}
                </span>
                {selected.kind === 'delete-edit' && (
                  <span className="muted">
                    {selected.deletedSide === 'local' ? '本地删除了该节点，远端做了修改' : '远端删除了该节点，本地做了修改'}
                  </span>
                )}
              </div>
              <div className="value-grid">
                <ValueView
                  label="基线 base"
                  tone="base"
                  value={selected.base}
                  absent={!selected.hasBase}
                  picked={(decisions[selected.id] ?? 'local') === 'base'}
                  onPick={selected.hasBase ? () => decide(selected.id, 'base') : undefined}
                />
                <ValueView
                  label="本地 local"
                  tone="local"
                  value={selected.local}
                  absent={!selected.hasLocal}
                  picked={(decisions[selected.id] ?? 'local') === 'local'}
                  onPick={() => decide(selected.id, 'local')}
                />
                <ValueView
                  label="远端 remote"
                  tone="remote"
                  value={selected.remote}
                  absent={!selected.hasRemote}
                  picked={(decisions[selected.id] ?? 'local') === 'remote'}
                  onPick={() => decide(selected.id, 'remote')}
                />
              </div>
              {!decisions[selected.id] && (
                <p className="muted">未裁决，当前默认采用本地。点击「采用」做出选择。</p>
              )}
            </main>
          )}
        </div>
      )}

      <section className="final-result">
        <div className="final-head">
          <h2>最终结果</h2>
          {decidedCount < conflicts.length && (
            <span className="warn">还有 {conflicts.length - decidedCount} 个冲突未裁决（暂按本地计入）</span>
          )}
          <div className="header-spacer" />
          <button onClick={copyResult}>复制 JSON</button>
        </div>
        <pre className="final-json">{JSON.stringify(merged, null, 2)}</pre>
      </section>
    </div>
  );
}
