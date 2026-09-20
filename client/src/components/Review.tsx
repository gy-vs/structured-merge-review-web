import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api';
import type { SessionDTO } from '../../../shared/api.js';
import {
  describeSide,
  materialize,
  type ConflictInfo,
  type Decision,
  type DecisionMap,
} from '../../../shared/merge.js';
import TreeView from './TreeView';
import ValueView from './ValueView';

const KIND_LABEL: Record<ConflictInfo['kind'], string> = {
  'both-modify': '双方修改',
  'both-add': '双方新增',
  'delete-vs-modify': '删除/修改',
  'type-change': '类型变化',
  'array-order': '数组顺序',
};

type SaveStatus = 'saved' | 'saving' | 'dirty' | 'conflict-merge';

/** 计算 from→to 之间发生变化（含新增/删除）的决策子集 */
function diffDecisions(from: DecisionMap, to: DecisionMap): DecisionMap {
  const out: DecisionMap = {};
  for (const k of Object.keys(to)) if (from[k] !== to[k]) out[k] = to[k];
  return out;
}

export default function Review({ sessionId }: { sessionId: string }) {
  const [session, setSession] = useState<SessionDTO | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [decisions, setDecisions] = useState<DecisionMap>({});
  const [past, setPast] = useState<DecisionMap[]>([]);
  const [future, setFuture] = useState<DecisionMap[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('saved');
  const [leftTab, setLeftTab] = useState<'conflicts' | 'tree'>('conflicts');

  const revisionRef = useRef(0);
  const savedRef = useRef<DecisionMap>({});
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savingRef = useRef(false);

  /* ---------------- 加载 / 恢复会话 ---------------- */
  useEffect(() => {
    let cancelled = false;
    api
      .getSession(sessionId)
      .then((s) => {
        if (cancelled) return;
        setSession(s);
        setDecisions(s.decisions);
        savedRef.current = s.decisions;
        revisionRef.current = s.revision;
        setSelectedId(s.conflicts[0]?.id ?? null);
        setPast([]);
        setFuture([]);
      })
      .catch((e) => !cancelled && setLoadError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  /* ---------------- 保存（防抖 + 409 合并重试） ---------------- */
  const persist = useCallback(
    async (next: DecisionMap) => {
      if (savingRef.current) return;
      savingRef.current = true;
      setSaveStatus('saving');
      try {
        const res = await api.saveDecisions(sessionId, revisionRef.current, next);
        if (res.status === 'ok') {
          revisionRef.current = res.revision;
          savedRef.current = next;
          setSaveStatus('saved');
        } else {
          // 另一个页面改过了：以服务端为基，叠加本地未保存的改动后重试
          const pending = diffDecisions(savedRef.current, next);
          revisionRef.current = res.revision;
          savedRef.current = res.decisions;
          const merged = { ...res.decisions, ...pending };
          setSaveStatus('conflict-merge');
          savingRef.current = false;
          setDecisions(merged); // 触发下一轮保存
          return;
        }
      } catch {
        setSaveStatus('dirty');
      }
      savingRef.current = false;
    },
    [sessionId],
  );

  useEffect(() => {
    if (!session) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => void persist(decisions), 500);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [decisions, session, persist]);

  /* ---------------- 决策 / 撤销 / 重做 ---------------- */
  const applyDecisions = useCallback(
    (next: DecisionMap) => {
      setPast((p) => [...p, decisions]);
      setDecisions(next);
      setFuture([]);
    },
    [decisions],
  );

  const choose = useCallback(
    (id: string, side: Decision) => applyDecisions({ ...decisions, [id]: side }),
    [decisions, applyDecisions],
  );

  const undo = useCallback(() => {
    setPast((p) => {
      if (p.length === 0) return p;
      const prev = p[p.length - 1];
      setFuture((f) => [decisions, ...f]);
      setDecisions(prev);
      return p.slice(0, -1);
    });
  }, [decisions]);

  const redo = useCallback(() => {
    setFuture((f) => {
      if (f.length === 0) return f;
      const [next, ...rest] = f;
      setPast((p) => [...p, decisions]);
      setDecisions(next);
      return rest;
    });
  }, [decisions]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'z') return;
      const target = e.target as HTMLElement;
      if (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT') return;
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo]);

  /* ---------------- 派生数据 ---------------- */
  const conflicts = session?.conflicts ?? [];
  const resolvedCount = conflicts.filter((c) => decisions[c.id]).length;
  const result = useMemo(
    () => (session ? materialize(session.tree, decisions) : null),
    [session, decisions],
  );
  const selected = conflicts.find((c) => c.id === selectedId) ?? null;

  if (loadError) {
    return (
      <div className="review">
        <p className="error-banner">加载会话失败：{loadError}</p>
        <a href="#">返回首页</a>
      </div>
    );
  }
  if (!session || !result) return <div className="review loading">加载中…</div>;

  const saveLabel: Record<SaveStatus, string> = {
    saved: '已保存',
    saving: '保存中…',
    dirty: '待保存',
    'conflict-merge': '检测到并发修改，已自动合并',
  };

  const exportResult = () => {
    const blob = new Blob([JSON.stringify(result.document, null, 2)], {
      type: 'application/json',
    });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${session.name || 'merged'}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="review">
      <header className="review-header">
        <a className="back" href="#">
          ← 首页
        </a>
        <h1>{session.name}</h1>
        <span className="progress">
          冲突 {resolvedCount}/{conflicts.length} 已决策
        </span>
        <div className="header-actions">
          <button onClick={undo} disabled={past.length === 0} title="Ctrl+Z">
            ↩ 撤销
          </button>
          <button onClick={redo} disabled={future.length === 0} title="Ctrl+Shift+Z">
            ↪ 重做
          </button>
          <span className={`save-status ${saveStatus}`}>{saveLabel[saveStatus]}</span>
        </div>
      </header>

      <div className="review-body">
        {/* 左栏：冲突列表 / 结构树 */}
        <aside className="panel left-panel">
          <div className="tabs">
            <button
              className={leftTab === 'conflicts' ? 'active' : ''}
              onClick={() => setLeftTab('conflicts')}
            >
              冲突 ({conflicts.length})
            </button>
            <button
              className={leftTab === 'tree' ? 'active' : ''}
              onClick={() => setLeftTab('tree')}
            >
              结构树
            </button>
          </div>
          {leftTab === 'conflicts' ? (
            conflicts.length === 0 ? (
              <p className="muted pad">无冲突，全部改动已自动合并。</p>
            ) : (
              <ul className="conflict-list">
                {conflicts.map((c) => (
                  <li key={c.id}>
                    <button
                      className={`conflict-item ${c.id === selectedId ? 'selected' : ''} ${
                        decisions[c.id] ? 'decided' : ''
                      }`}
                      onClick={() => setSelectedId(c.id)}
                    >
                      <span className="conflict-path">{c.pathDisplay}</span>
                      <span className="conflict-meta">
                        <span className={`badge kind-${c.kind}`}>{KIND_LABEL[c.kind]}</span>
                        <span className="muted">
                          {decisions[c.id] ? `→ ${decisions[c.id]}` : '未决策'}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )
          ) : (
            <TreeView
              root={session.tree}
              decisions={decisions}
              selectedId={selectedId}
              onSelect={(id) => {
                setSelectedId(id);
                setLeftTab('conflicts');
              }}
            />
          )}
        </aside>

        {/* 中栏：三方对比与决策 */}
        <section className="panel compare-panel">
          {selected ? (
            <>
              <h2 className="current-path" title={selected.pathDisplay}>
                {selected.pathDisplay}
              </h2>
              <p className="muted">
                <span className={`badge kind-${selected.kind}`}>{KIND_LABEL[selected.kind]}</span>
              </p>
              <div className="three-way">
                {(['base', 'local', 'remote'] as const).map((side) => (
                  <div
                    key={side}
                    className={`side-card ${decisions[selected.id] === side ? 'chosen' : ''}`}
                  >
                    <div className="side-head">
                      <strong>{side}</strong>
                      <span className="muted">{describeSide(selected[side])}</span>
                    </div>
                    <ValueView side={selected[side]} />
                    <button
                      className={decisions[selected.id] === side ? 'primary' : ''}
                      onClick={() => choose(selected.id, side)}
                    >
                      {decisions[selected.id] === side ? '✓ 已采用' : `采用 ${side}`}
                    </button>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <p className="muted pad">
              {conflicts.length === 0 ? '没有需要决策的冲突。' : '从左侧选择一个冲突进行决策。'}
            </p>
          )}
        </section>

        {/* 右栏：最终结果 */}
        <section className="panel result-panel">
          <div className="result-head">
            <h2>合并结果</h2>
            <div>
              <button
                onClick={() => navigator.clipboard.writeText(JSON.stringify(result.document, null, 2))}
              >
                复制
              </button>
              <button className="primary" disabled={!result.complete} onClick={exportResult}>
                导出
              </button>
            </div>
          </div>
          {!result.complete && (
            <p className="warn-banner">还有 {result.unresolved.length} 个冲突未决策，以下为占位预览。</p>
          )}
          <pre className="result-json">{JSON.stringify(result.document, null, 2)}</pre>
        </section>
      </div>
    </div>
  );
}
