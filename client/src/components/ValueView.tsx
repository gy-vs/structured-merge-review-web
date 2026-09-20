import type { Side } from '../../../shared/merge.js';

export default function ValueView({ side }: { side: Side }) {
  if (!side.present) {
    return <pre className="value-view absent">（不存在）</pre>;
  }
  return <pre className="value-view">{JSON.stringify(side.value, null, 2)}</pre>;
}
