# 新版参赛材料与运行指引

作品：一刻烟火：15分钟生活圈智能体检与规划助手。更新日期：2026-10-16。功能基线：`e28efa0`；材料固定版本：`os2026-baidu-v2-20261016`。

本版按百度企业赛题的**功能正确性与覆盖率40%、API深度调用与工程优化30%、产品交互与用户体验15%、开源工程规范15%**组织，不沿用通用赛道的30/30/20/20。

## 三项提交物

| 材料 | 入口 | 内容 |
| --- | --- | --- |
| 完整代码 | [固定版本源码](https://github.com/TingxuanHan/yike-yanhuo/tree/os2026-baidu-v2-20261016) | 可运行Web、微信原生开发版、锁文件、构造数据、复算和测试脚本 |
| 作品介绍 | [18页PDF](../materials/yike-yanhuo-baidu-v2.pdf) · [可编辑文稿](submission-v2-brief.md) | 背景、架构、场景、实现增量、API成本、对照结果、规范与维护安排 |
| 演示视频 | [新版有声字幕MP4](https://github.com/TingxuanHan/yike-yanhuo/releases/download/os2026-baidu-v2-20261016/yike-yanhuo-baidu-v2.mp4) | 26个分镜、中文配音和烧录字幕；另附SRT、封面及[逐字稿](submission-v2-transcript.md) |

[新版发布页与全部附件](https://github.com/TingxuanHan/yike-yanhuo/releases/tag/os2026-baidu-v2-20261016)提供源码ZIP、材料ZIP、SHA-256清单与机器检查记录。发布页上的材料版本和源码提交由`submission-v2-manifest.json`对应；视频和PDF标注的是功能基线，不把材料整理误写成业务功能改动。

**访问状态：仓库和Release仍为私有。** 有授权的GitHub账号可以访问；外部评审访问和赛题要求的开源公开方式须在正式提交前落实。没有自动更改可见性、发送报名邮件或宣称已完成比赛提交。

## 本版更新

视频实际演示连续设施覆盖、定向补查、最多七种补点组合、三条件取舍、绕行核查、先冻结预测的固定抽点、报告导出、步速对比、整趟计划、入口反馈、备选、离线卡与家人建议。上海路线使用已保存的真实API结果；微信原生页面和历史模型/语音联调以明确标记的静帧展示。

PDF还覆盖POI清洗、共享边加密、个人实走校准、私人小店、大字简易模式、跨端同步、密钥与数据边界，以及现场与手机验收计划。不能把静帧或API对照当成现场通行与正式上线证明。

## 五分钟运行入口

Node.js最低22.13，推荐24。Web示例不需要Python、FFmpeg、微信账号或地图密钥。

```sh
git clone https://github.com/TingxuanHan/yike-yanhuo.git
cd yike-yanhuo
git checkout os2026-baidu-v2-20261016
npm ci
npm run build
npm start
```

源码ZIP解压后在`yike-yanhuo/`目录执行后三条命令即可，无需GitHub登录。首次安装依赖需要访问npm源。

- 居民示例：`http://127.0.0.1:8787/` → 我要出门 → 核算整趟行程 → 按这条安排出门。
- 社区示例：`http://127.0.0.1:8787/?showcase=1` → 体验模拟社区 → 查设施缺口 → 补查、补点、绕行及抽点。
- 微信：先`npm run build:mini`，导入`miniprogram/`；AppID与权限依账号配置，见[导入说明](../miniprogram/README.md)。
- 跨网络同步、协助和真实接口需独立配置共同HTTPS服务及本地密钥，见[部署说明](deployment.md)。Docker尚无本机容器验收。

## 证据与复算

功能基线已通过244项业务/API/原生页面测试、44项浏览器流程和构建；[基线CI](https://github.com/TingxuanHan/yike-yanhuo/actions/runs/38906576962)可追溯。普通测试及以下构造复算均不发起真实地图调用。

```sh
npm test
npm run test:ui
npm run benchmark:coverage
npm run benchmark:siting
npm run benchmark:planning
npm run benchmark:contour
npm run benchmark:walk
```

浏览器测试需先安装Playwright Chromium：`npx playwright install chromium`。导出文件还可用`verify:repair`、`verify:planning`和`verify:contour`脚本复算，参数见对应功能说明。

- [上海24点对照](experiments/shanghai-comparison.md)：15分钟133点轮廓23/24、直线圆16/24；5分钟加密没有全面改善。
- [第二组24点](experiments/shanghai-refinement.md)：5分钟20/24 → 21/24，漏判少2、误判多1。
- [等时圈抽点](contour-audit.md)：构造反例保留5分钟9/12；10月16日六点重复接口核对消耗6条路线，沿用旧位置，不能当作新独立样本或现场真值。
- [多条件与绕行](planning-evidence.md)：构造排名反转和空间交集；上海144个有效已测点、37个超时、26条绕行线索，均不等于确认障碍。
- [补查](targeted-verification.md)、[补点](facility-siting.md)、[实走校准](walk-calibration.md)各自保留来源、边界与构造数据。
- [本版材料验收](submission-v2-validation.md)、[PDF检查](validation/submission-v2-doc.json)、[视频检查](validation/submission-v2-video.json)。

成片中的[五份构造导出文件](../materials/submission-v2-evidence/)随源码保存，`python scripts/verify-submission-v2-replays.py`可统一独立重算。它们是录屏输入与结果的留档，不是新增五组独立实验。

## 材料重建

重建脚本依赖本机ReportLab、pypdf、中文字体、SAPI中文语音、FFmpeg、Poppler和Playwright。它们不属于运行Web所必需的依赖。字体和语音引擎未打包进源码；Python可执行文件按环境选择。

```powershell
python scripts/build-submission-v2.py
python scripts/verify-submission-v2-doc.py
./scripts/make-submission-voice.ps1 -Variant v2
$env:SUBMISSION_VARIANT='v2'
node scripts/record-submission.mjs
python scripts/compose-submission.py
node scripts/verify-submission-video.mjs
```

录制脚本使用独立8790端口、内存私人数据与空地图密钥，阻止外部和真实接口请求。`REHEARSAL_FAST=1`仅作彩排，不作为成片。提交材料改动并完成验收后，`python scripts/package-submission-v2.py`从Git提交导出源码及校验材料包，不打包本地未提交配置。

历史v1视频、16页百度修订PDF与2页校准补充PDF保留原路径；它们与本版的源码、页数和校验值不同。

## 提交邮件草稿（未发送）

主题：2026上海开源软件应用创新大赛作品提交：一刻烟火：[报名人/团队]

组委会老师您好：

现提交百度地图企业赛题作品“一刻烟火：15分钟生活圈智能体检与规划助手”。附件为新版18页作品介绍与运行材料索引，代码及演示视频链接如下：

- 代码：`https://github.com/TingxuanHan/yike-yanhuo/tree/os2026-baidu-v2-20261016`
- 视频：`https://github.com/TingxuanHan/yike-yanhuo/releases/download/os2026-baidu-v2-20261016/yike-yanhuo-baidu-v2.mp4`
- 附件与校验包：`https://github.com/TingxuanHan/yike-yanhuo/releases/tag/os2026-baidu-v2-20261016`

材料围绕百度40/30/15/15指标说明实现与证据，区分构造演示、历史API回放、重复接口核对和待现场核验事项。请查收。

报名人/团队：[填写]；报名编号：[若有]；联系方式：[填写]。

发送前按确认邮件核对截止时间、外部链接访问和附件大小。若未解决私有权限，不直接把上述链接当成可供评审访问的公开地址。
