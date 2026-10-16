# 一刻烟火：完整功能参赛材料

项目名称：**一刻烟火**。参赛赛道：**开源 AI 工具赛道**。企业赛题：**【开源 AI 工具赛道】百度地图赛题：基于地图开放能力的“15 分钟生活圈”智能体检与规划助手**。

负责人：**韩庭轩**；单位/学校：**南京大学**；其他团队成员：**姜可**。完整报名信息保留在文档封面；视频不包含负责人、学校和其他成员信息。

## 提交材料

- **完整可运行代码**：[公开仓库](https://github.com/TingxuanHan/yike-yanhuo) · [固定版本](https://github.com/TingxuanHan/yike-yanhuo/tree/os2026-baidu-v4.1-20261016)。
- **作品介绍**：[14页PDF](../materials/yike-yanhuo-baidu-v4.pdf) · [可编辑文稿](submission-v4-brief.md)。
- **作品演示视频**：[完整有声字幕视频](https://github.com/TingxuanHan/yike-yanhuo/releases/download/os2026-baidu-v4.1-20261016/yike-yanhuo-baidu-v4.mp4) · [SRT字幕](../materials/yike-yanhuo-baidu-v4.srt) · [逐字稿与章节时间](submission-v4-transcript.md)。
- [全部附件、源码ZIP及校验清单](https://github.com/TingxuanHan/yike-yanhuo/releases/tag/os2026-baidu-v4.1-20261016)。v3保留为6页/3分27秒简版，正式完整材料采用本页v4。

## 全部已实现功能与创新索引

| 功能组                                                 | 文档页    | 视频分镜                       | 实现与验证入口                                                          |
| ------------------------------------------------------ | --------- | ------------------------------ | ----------------------------------------------------------------------- |
| 简易、大字、常用地点、家人入口                         | 2、10、12 | simple、mini、family           | SimpleHome、微信home；simple-family/mini-family测试                     |
| 地址、坐标、底图、六类POI、道路测时、5/10/15分钟       | 3、4      | locate、analyze、range、places | BaiduGateway、BaiduMap、analyze；baidu/core/mesh测试                    |
| 共享边两轮加密、孔洞与未知、预算/串行/缓存/取消        | 3、4      | algorithm、analyze             | mesh、contours、quota、runtime-lease；baidu-rate测试                    |
| 连续覆盖、三类1公里核查、台账、来源冲突与复核日期      | 5         | coverage、review               | coverage-area、FacilityReview、ReviewReminders；coverage/poi-review测试 |
| 定向补查、用量预览、采用/恢复与导出                    | 5         | repair                         | verification、VerificationPanel；verification/mini-verification测试     |
| 1至3补点组合、同数量比较、去重、多条件共同收益         | 6         | siting、conditions             | facility-siting、siting-conditions；mini-siting/planning-evidence测试   |
| 绕行线索、冻结预测与6/12分离抽点                       | 6         | detour、audit                  | detour-audit、contour-audit；对应核心/HTTP/原生测试                     |
| 时长、步速、出发时间、峰谷等灯、条件对比               | 7         | personal                       | journey、personalize、journey-comparison；journey测试                   |
| 事前预测、至少3条校准、后续检验、采用/排除/恢复        | 7         | calibration                    | walk-calibration、WalkCalibration；mini-calibration/UI校准测试          |
| 私人小店、坐标/照片/地标/到访/营业、收藏搜索           | 10        | placebook                      | LifePanel、life、place-photo；life/mini-contract测试                    |
| 大字地点卡、朗读、打印、7天只读分享与撤销              | 10        | placebook、mini                | SharedPlaceCard、cards；family-card/cards测试                           |
| 多任务往返、停留/营业等待、熟路照片、分段歇脚          | 8         | daily、familiar                | outings、trip、OutingsPanel；mini-outings/trip测试                      |
| 购物清单、规格价格、实付/库存/过期、推荐与预算         | 9         | shopping、daily                | shopping、ShoppingPanel；mini-shopping/UI购物测试                       |
| 轻快交替、歇脚、返回核算与目标不足                     | 9         | movement                       | movement、MovementPanel；mini-movement/UI运动测试                       |
| 基础AI、自用API、域名/密钥保护、结构化草稿与确认       | 11        | ai_settings                    | ai-service、ai-transport、planning；mini-planning/UI规划测试            |
| 录音权限、主动发送、可编辑转写、确认后规划             | 11        | voice                          | VoiceInput、voice-recorder、VoiceSession；voice/mini测试                |
| 入口/路段提醒、来源/时效/冲突、通行需要相关性          | 13        | notice、conflict               | neighborhood、NeighborhoodPanel；neighborhood/UI/原生测试               |
| 下一站备选、同店另一入口、费用时间比较与恢复           | 8、13     | alternative、entrance          | trip-alternative、TripAlternatives；trip-alternative/UI测试             |
| 逐站执行、剩余路段指引、文字步骤与本地缓存             | 8         | walking                        | WalkingGuide、walking-guide；walking-guide/mini测试                     |
| 常用方案、返程/电话、独立离线HTML出门卡                | 8         | card                           | TripPreparation、offline-departure；departure/UI测试                    |
| 一键电话、一次定位、拒绝/旧记录/估计范围、短期卡与回应 | 12        | location、simple               | family、FamilyPanel；family/mini-family/simple-family测试               |
| 家人短期建议、本人确认/保留、主动结束                  | 12        | family                         | assistance、TripAssistance；assistance/mini-assistance测试              |
| 原生微信、共享核心、平台适配、私人空间/配对/HTTP409    | 3、14     | sync、mini                     | LifeStore、src/mini、platform；life/server/mini-contract测试            |
| 备份、同步合并/替换、共享报告、保存/回放/导出/打印     | 14        | sync、report                   | LifePanel、ResultLibrary、Report；library/life/departure测试            |
| MIT、依赖清单、贡献/安全、锁文件、部署与CI             | 3、14     | finish                         | LICENSE、THIRD_PARTY_NOTICES、CONTRIBUTING、SECURITY、部署和CI          |

视频以核心操作与结果覆盖每个功能组，不逐项朗读所有表单字段；参数边界、证据与可复现入口由文档及源码补全。支付宝仅留适配准备，实时行人信号、正式微信上线和真实实走效果没有作为已实现成果。

## 运行与证据

推荐Node.js 24，最低22.13；`npm ci`、`npm run build`、`npm start`，打开`http://127.0.0.1:8787`。零密钥可体验构造示例；真实服务按`.env.example`使用自己的凭据。

本轮上海真实API报告在[原始输入](../materials/submission-v3-evidence/shanghai-analysis.json)与[调用摘要](../materials/submission-v3-evidence/live-summary.json)。236条路线、6次检索、177点、60处设施；无失败与重试，路线请求最小启动间隔1101ms。v4复用同轮证据，补录阶段空密钥、零外部API。构造街区、历史语音/路线接口留档与微信页面静帧在视频章节分别标明。

14页介绍保留背景、架构、场景、全部已实现功能和方法，没有加回提交说明或空泛展望。35个分镜采用预设普通话神经网络配音，字幕逐句烧录，另附SRT。媒体与版式验收见[记录](submission-v4-validation.md)。
