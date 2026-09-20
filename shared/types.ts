export type JSONValue =
  | null
  | boolean
  | number
  | string
  | JSONValue[]
  | { [key: string]: JSONValue };

/** 用户对某个冲突的裁决：采用本地 / 远端 / 基线 */
export type Choice = 'local' | 'remote' | 'base';

export type ConflictKind =
  | 'value'        // 同一标量被两侧改成不同值
  | 'type'         // 同一路径两侧变成了不同类型
  | 'add-add'      // 两侧都新增了同一路径但内容不同
  | 'delete-edit'  // 一侧删除父节点，另一侧修改其子节点
  | 'array-order'; // 数组两侧重排方式不一致

export interface Conflict {
  /** 由路径 + 类型派生的稳定 id，同一输入下多次合并结果一致 */
  id: string;
  /** 人类可读路径，如 /user/name 或 /items[id=3]/price */
  path: string;
  kind: ConflictKind;
  /** delete-edit 时是哪一侧执行的删除 */
  deletedSide?: 'local' | 'remote';
  hasBase: boolean;
  hasLocal: boolean;
  hasRemote: boolean;
  base?: JSONValue;
  local?: JSONValue;
  remote?: JSONValue;
}

export interface MergeResult {
  /** 应用 decisions 后的合并结果；未裁决的冲突默认采用 local */
  merged: JSONValue;
  conflicts: Conflict[];
}

export type Decisions = Record<string, Choice>;

export interface SessionRecord {
  id: string;
  name: string;
  revision: number;
  base: JSONValue;
  local: JSONValue;
  remote: JSONValue;
  decisions: Decisions;
  createdAt: string;
  updatedAt: string;
}

export interface SessionSummary {
  id: string;
  name: string;
  revision: number;
  updatedAt: string;
}
