# 合作卡（「合作」卡）、点击统计与详情滑动

- **配置**：`POST /api/admin/ads`（`x-admin-key`）。字段：id、owner(商家地址)、brand、title、text、cover/image(https)、mode(`inline`｜`external`，https)、url、enabled。**排名由出价决定，不再有手工 rank / until**，详见 [ads-ranking.md](ads-ranking.md)。外链与文案写入前先过钓鱼黑名单与正向内容审核；`GET /api/ads?page=N` 公开返回该页广告位（不含得分/出价）。数据在 `data/ads.json`，经 persist.js 同步 D1。
- **广告位**：每页 100 张卡，广告位固定在第 5,10,…,100 位（20 个）；第 N 页取全局名次 (N-1)×20+1…N×20；名次不足的位置由自然卡按原顺序填充；无广告时 feed 与原来完全一致。规则在前端 `buildFeedItems`（verify-ads.js 覆盖）。
- **点击**：全站统一的委托点击入口 `openFeedCard`：合作卡与自然卡共用站内展开（进入详情）；合作卡配置为 external 时先弹站内确认对话框（非 window.confirm），再次检查黑名单后 `window.open(url,'_blank','noopener,noreferrer')`。
- **统计**：`POST /api/track`（card_click / ad_click / card_view），仅聚合计数，键为 `日期|事件|广告id|名次|位置`；自然卡只计总数；不存 IP / 地址 / UA；按 IP 每分钟 90 次内存限流（IP 不落盘）。管理员 `GET /api/admin/ads?days=7` 查看汇总。
- **详情滑动**：沿用首页列表的有序数组；左右滑动（≥50px）、上一张/下一张按钮、←/→ 键；两端提示变暗；动画锁 300ms；监听器由 AbortController 在离开详情时清理；每次切换上报 card_view；距末尾 10 张内预取下一页，最后一张显示「下一页 →」，加载中显示「加载中…」，失败显示重试提示，无更多数据则变暗。分页为每页 100 张（数据来自已同步的链上心愿，分页请求同时刷新合作卡配置）。
