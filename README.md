# 三方合并工作台

浏览器里的结构化三方合并工具：输入基线 / 本地 / 远端三份 JSON，互不冲突的改动自动合并，真正的冲突逐项裁决。无需账号、命令行或外部数据库。

## 运行

```bash
npm install
npm run dev        # 前端 http://localhost:5173 （/api 代理到 3001），后端 http://localhost:3001
npm test           # Vitest：合并语义 + 并发保存
npm run typecheck  # tsc --noEmit
npm run build      # 构建前端到 dist/
npm start          # 生产模式：同一端口托管 API 与静态页面
```

## 合并语义（shared/merge.ts）

- 一侧未动 → 采用另一侧（单边增 / 删 / 改自动合并）。
- 对象按字段递归；数组按元素稳定 `id` 对齐（无 `id` 的元素按序号对齐），仅重排不算冲突。
- 冲突类型：`value`（标量改不同值）、`type`（类型变化）、`add-add`（双方新增同路径）、
  `delete-edit`（一侧删父节点、另一侧改子节点）、`array-order`（两侧重排不一致）。
- 冲突 id 由路径 + 类型派生，同一输入下稳定；`merge(base, local, remote, decisions)`
  是纯函数，刷新后凭已保存的 decisions 恢复出完全一致的结果。未裁决的冲突默认采用本地。

## 后端（server/）

- `SessionStore` 为可注入接口，默认 `InMemorySessionStore`（进程内 Map）。
- `PUT /api/sessions/:id` 携带 `revision` 做乐观并发：不一致返回 `409 + 当前记录`，
  绝不最后写入覆盖。前端收到 409 后以服务器决策为底叠加本地决策，用新 revision 重试。

## 前端（web/）

- 审阅页三栏：冲突列表 / 当前冲突的三方值与裁决 / 实时最终结果。
- 撤销 / 重做（Ctrl+Z、Ctrl+Shift+Z），裁决自动防抖保存，刷新后从会话列表恢复。
- 窄屏（<860px）下三栏堆叠为单列。
