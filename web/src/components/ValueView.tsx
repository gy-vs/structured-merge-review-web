import type { JSONValue } from '../../../shared/types';

/** 展示一份 JSON 值；absent=true 表示该侧不存在（已删除/未新增） */
export function ValueView({
  value,
  absent,
  label,
  tone,
  picked,
  onPick,
}: {
  value?: JSONValue;
  absent: boolean;
  label: string;
  tone: 'base' | 'local' | 'remote';
  picked?: boolean;
  onPick?: () => void;
}) {
  return (
    <div className={`value-card tone-${tone} ${picked ? 'picked' : ''}`}>
      <div className="value-card-head">
        <span className="value-label">{label}</span>
        {onPick && (
          <button className="pick-btn" onClick={onPick}>
            {picked ? '✓ 已采用' : '采用'}
          </button>
        )}
      </div>
      {absent ? (
        <div className="absent">（不存在 / 已删除）</div>
      ) : (
        <pre className="value-json">{JSON.stringify(value, null, 2)}</pre>
      )}
    </div>
  );
}
