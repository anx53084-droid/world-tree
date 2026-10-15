# 门卡（Gate Card）与树洞

门卡 = **线上访问凭证**：灵魂绑定、不可转让、无实体卡、非资产、不承诺任何收益；名称与权益说明须通过正向内容审核。

## 数据模型
- 链上（memo，向后兼容）：`WTREE1|W|hash|ts|sig|<类别>~Q~g<编号>~n<名称>~T<接收地址>[~e<到期秒>]~h<权益说明 sha16>|text`。缺省 `~e` = 永久；旧客户端忽略未知 token。
- 服务端记录（`data/gates.json`，经 persist.js 同步 D1）：cards / claimable / claims / rules / posts。字段：cardId、owner、gateId(=ruleId)、expireAt(0=永久)、status(active/revoked)、issuer；链下附加：规则名、权益说明、领取时间、提醒状态。

## 取舍：服务端状态记录 vs 链上后续交易
撤销、到期提醒、领取资格复核都需要可变状态；链上 memo 不可改，每次变更再发交易会产生手续费且不可撤回。因此**状态以服务端记录为权威**，链上 memo 仅证明「发行」；到期仅按时间戳判定（前后端各自复判，不依赖定时任务）。预留可选的链上锚点钩子（默认关闭）：未来可把 revoke 作为一笔新 memo 上链，服务端以其为准。自动领取路径目前为 demo 服务端模式（不上链）。

## 成就门卡与树洞
| 规则 | 条件 | 有效期 | 默认 |
| --- | --- | --- | --- |
| first_light 初心 | 1 张链上心愿 | 永久 | 启用 |
| growth 成长 | 5 张心愿 | 永久 | 启用 |
| resonance 共鸣 | 收到 10 条有效祝福 | 180 天 | 停用 |
| monthly 月度 | 单月新增 3 张心愿 | 月底 + 30 天 | 停用 |
| event 活动限定 | 管理员自定义 | 自定义 | 停用 |
管理员可用 `POST /api/admin/gate/rules`（x-admin-key）启用/调整；`/api/admin/gate/issue` 批量发放；`/api/gate/revoke` 撤销（发行方或管理员）。
- 反滥用：每人每规则 1 张；全局 24 小时内最多领 1 张；领取前服务端按链上统计重新复核；领取资格默认 30 天过期。
- 树洞（`#/treehole`）：`/api/treehole*` 每次请求都在服务端校验持卡（任一 `unlocks:['treehole']` 的有效门卡），否则 403（NOT_LOGIN/NO_GATE/EXPIRED/REVOKED/NOT_OWNER）且不返回任何内容。内容存服务端，140 字内，走正向审核 + 链接黑名单，每日限 10 条。
- 提醒：收到 / 可领取 / 到期前 3 天 / 当天 / 已过期 / 撤销，站内信；可在消息设置关闭。
- 测试：`node verify-gate.js`（不上链；`GATE_MOCK_STATS=1` 用 `data/gate-mock-stats.json` 模拟统计）。
