import type { DecisionMap, MergeNode } from '../../../shared/merge.js';

interface Props {
  root: MergeNode;
  decisions: DecisionMap;
  selectedId: string | null;
  onSelect: (conflictId: string) => void;
}

/** 合并树的只读结构视图：冲突节点高亮，点击定位到决策面板。 */
export default function TreeView({ root, decisions, selectedId, onSelect }: Props) {
  return (
    <div className="tree-view">
      <NodeView label="$" node={root} decisions={decisions} selectedId={selectedId} onSelect={onSelect} depth={0} />
    </div>
  );
}

interface NodeProps {
  label: string;
  node: MergeNode;
  decisions: DecisionMap;
  selectedId: string | null;
  onSelect: (conflictId: string) => void;
  depth: number;
}

function NodeView({ label, node, decisions, selectedId, onSelect, depth }: NodeProps) {
  if (node.kind === 'value') {
    return (
      <div className="tree-row" style={{ paddingLeft: depth * 14 }}>
        <span className="tree-label">{label}</span>
        <span className="tree-scalar">{JSON.stringify(node.value)}</span>
      </div>
    );
  }

  if (node.kind === 'conflict') {
    const decided = decisions[node.id];
    return (
      <button
        type="button"
        className={`tree-row tree-conflict ${selectedId === node.id ? 'selected' : ''} ${decided ? 'decided' : ''}`}
        style={{ paddingLeft: depth * 14 }}
        onClick={() => onSelect(node.id)}
      >
        <span className="tree-label">{label}</span>
        <span className="tree-flag">{decided ? `✓ 采用 ${decided}` : '⚠ 冲突'}</span>
      </button>
    );
  }

  if (node.kind === 'object') {
    const keys = Object.keys(node.children);
    return (
      <details open={depth < 3}>
        <summary className="tree-row" style={{ paddingLeft: depth * 14 }}>
          <span className="tree-label">{label}</span>
          <span className="tree-type">{`{${keys.length}}`}</span>
        </summary>
        {keys.map((k) => (
          <NodeView
            key={k}
            label={k}
            node={node.children[k]}
            decisions={decisions}
            selectedId={selectedId}
            onSelect={onSelect}
            depth={depth + 1}
          />
        ))}
      </details>
    );
  }

  // array
  return (
    <details open={depth < 3}>
      <summary className="tree-row" style={{ paddingLeft: depth * 14 }}>
        <span className="tree-label">{label}</span>
        <span className="tree-type">{`[${node.items.length}]`}</span>
        {node.orderConflict && (
          <button
            type="button"
            className={`tree-flag link ${decisions[node.orderConflict.id] ? 'decided' : ''}`}
            onClick={(e) => {
              e.preventDefault();
              onSelect(node.orderConflict!.id);
            }}
          >
            {decisions[node.orderConflict.id] ? '✓ 顺序已定' : '⚠ 顺序冲突'}
          </button>
        )}
      </summary>
      {node.items.map((item) => (
        <NodeView
          key={item.key}
          label={`[${item.label}]`}
          node={item.node}
          decisions={decisions}
          selectedId={selectedId}
          onSelect={onSelect}
          depth={depth + 1}
        />
      ))}
    </details>
  );
}
