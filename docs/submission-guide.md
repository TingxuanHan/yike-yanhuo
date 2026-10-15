# 参赛材料与评审运行指引

作品：一刻烟火：15分钟生活圈智能体检与规划助手。提交版日期：2026-10-16。

开发增强补充：功能基线`541d9cf`加入[实走校准](walk-calibration.md)与[2页补充PDF](../materials/yike-yanhuo-calibration-addendum.pdf)。[四组构造对照](experiments/walk-calibration-simulation.md)保留建议改善和失效情况；193项业务测试、36项浏览器流程通过。下方v1固定源码、14页文档与视频仍对应原版本，不包含新功能；需要展示新功能时应使用main的新提交与补充说明，不能把原视频说成已演示该功能。补充PDF可用`scripts/build-calibration-addendum.py`重建。

## 三项提交物

| 材料 | 固定入口 | 说明 |
| --- | --- | --- |
| 完整源码 | [仓库](https://github.com/TingxuanHan/yike-yanhuo/tree/os2026-submission-v1) | 固定标签 `os2026-submission-v1`；Release另附同版本源码ZIP |
| 作品介绍 | [14页PDF](../materials/yike-yanhuo-submission.pdf) | 背景、架构、场景、创新、对照结果、治理、90天计划；按30/30/20/20组织 |
| 演示视频 | [MP4下载/播放文件](https://github.com/TingxuanHan/yike-yanhuo/releases/download/os2026-submission-v1/yike-yanhuo-submission.mp4) | 中文配音、烧录字幕，另附SRT；展示真实界面操作和明确标注的回放 |

[发布页与全部附件](https://github.com/TingxuanHan/yike-yanhuo/releases/tag/os2026-submission-v1)提供PDF、MP4、SRT、源码包、SHA-256校验清单和完整材料包。GitHub附件可能直接下载；MP4采用H.264/AAC、16:9与快速启动，可用常见播放器打开。

**访问状态：** 当前仓库仍按所有者原要求保持私有，链接需要授权账号登录。企业任务书要求开源源码，因此正式提交前必须由所有者确认公开发布方式；只拥有本地文件或私有链接不等于已经满足外部评审访问。尚未发送比赛邮件，也没有代替所有者完成报名信息确认。

## 五分钟运行入口

需要Node.js 22.13以上，推荐24。无需Python、FFmpeg、微信账号或地图AK即可运行Web示例。

```sh
git clone https://github.com/TingxuanHan/yike-yanhuo.git
cd yike-yanhuo
git checkout os2026-submission-v1
npm ci
npm run build
npm start
```

打开 `http://127.0.0.1:8787/`：简易首页 → 我要出门 → 核算整趟行程 → 按这条安排出门。

打开 `http://127.0.0.1:8787/?showcase=1`：体验模拟社区 → 切换5/10/15分钟 → 核查药店/菜市场/小学 → 对比步速 → 阅读与导出报告。

源码ZIP包含顶层 `yike-yanhuo/` 目录，解压后在该目录执行同样的 `npm ci`、构建和启动命令。没有附带私人数据、AK、模型密钥或node_modules；首次安装需要可访问npm源。微信原生开发版见 [导入说明](../miniprogram/README.md)，云部署与跨网络协助见 [部署说明](deployment.md)。Docker配置尚未在本机完成容器验收。

## 测试与可复核证据

```sh
npm test
npm run test:ui
npm run benchmark:demo
```

浏览器测试需要Playwright Chromium：按环境执行 `npx playwright install chromium`。普通测试均使用构造环境，不会自动发起真实API调用。功能基线 `09b3027` 已完成184项业务/接口/小程序业务测试、34项浏览器流程和生产构建；该提交的 [CI](https://github.com/TingxuanHan/yike-yanhuo/actions/runs/38765916736) 可追溯。提交版材料生成与成片检查另见 [材料验收记录](submission-validation.md)。

- 上海第一组固定24点：[实验与完整计数](experiments/shanghai-comparison.md)。15分钟133点轮廓23/24，与直线圆16/24对照；5分钟没有全面改善。
- 第二组预先固定24点：[加密复核](experiments/shanghai-refinement.md)。5分钟20/24 → 21/24；不可冒充全面准确率提升。
- 最新5次百度路线调用：[验证记录](validation.md)、[保存回放](validation/baidu-alternative-replay.json)。API数据不等于现场入口、营业或无障碍验证。
- 治理：[贡献指南](../CONTRIBUTING.md)、[维护决策](../GOVERNANCE.md)、[安全边界](../SECURITY.md)、[依赖许可](../THIRD_PARTY_NOTICES.md)。

## 文稿与视频复现

- [作品介绍可编辑文本](submission-brief.md)、[旁白与章节](submission-transcript.md)、[分镜JSON](submission-video.json)。
- `scripts/build-submission.py`：用ReportLab生成PDF；Windows默认微软雅黑，可按脚本参数指定字体；输出须重新逐页渲染检查。
- `scripts/make-submission-voice.ps1`：调用本机SAPI中文语音，输出缓存WAV；不调用付费合成服务。
- `scripts/record-submission.mjs`：生产构建后，启动独立8790端口、内存数据和空地图密钥，用无头浏览器录制；禁止外部与真实API请求。`REHEARSAL_FAST=1`只作流程检查。
- `scripts/compose-submission.py`：按逐句语音和场景时间拼接，生成带烧录字幕的MP4、SRT与封面；需要本机FFmpeg。
- `scripts/dependency-inventory.mjs`：从锁文件重建许可清单。

历史语音/模型测试截图已随材料保存于 `materials/submission-assets/`。若重录，读取这些归档图，不要求本机保留此前的测试缓存。系统字体、语音引擎与FFmpeg未打包进源码。

## 提交邮件草稿（未发送）

主题：2026上海开源软件应用创新大赛作品提交—一刻烟火—[报名人/团队]

组委会老师您好：

现提交作品“一刻烟火：15分钟生活圈智能体检与规划助手”，参赛方向为百度地图企业赛题。附件包含作品介绍PDF、代码运行说明和材料索引。代码仓库与演示视频链接如下：

- 代码：`https://github.com/TingxuanHan/yike-yanhuo/tree/os2026-submission-v1`
- 视频：`https://github.com/TingxuanHan/yike-yanhuo/releases/download/os2026-submission-v1/yike-yanhuo-submission.mp4`
- 全部附件：`https://github.com/TingxuanHan/yike-yanhuo/releases/tag/os2026-submission-v1`

文档区分模拟演示、百度API对照与待实地核验事项。请查收。

报名人/团队：[按确认邮件填写]；报名编号：[若有]；联系方式：[由报名人填写]。

发送前检查：链接外部可访问、报名确认邮件是否要求额外字段、附件大小是否满足收件限制。用户提供的截止时间为10月16日24:00，以报名确认邮件与大赛通知为准。
