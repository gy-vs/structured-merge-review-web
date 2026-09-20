import type { ConflictInfo, DecisionMap, MergeNode } from './merge.js';

/** GET /api/sessions/:id 与 POST /api/sessions 的响应体 */
export interface SessionDTO {
  id: string;
  name: string;
  revision: number;
  decisions: DecisionMap;
  conflicts: ConflictInfo[];
  tree: MergeNode;
  createdAt: string;
  updatedAt: string;
}

export interface SessionSummary {
  id: string;
  name: string;
  revision: number;
  decisionCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface SaveOk {
  status: 'ok';
  revision: number;
  decisions: DecisionMap;
}

export interface SaveConflict {
  status: 'conflict';
  revision: number;
  decisions: DecisionMap;
}

export type SaveResponse = SaveOk | SaveConflict;
