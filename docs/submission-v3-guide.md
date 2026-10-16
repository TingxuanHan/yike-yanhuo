# 一刻烟火：参赛材料

| 项目         | 内容                                                                                  |
| ------------ | ------------------------------------------------------------------------------------- |
| 项目名称     | 一刻烟火                                                                              |
| 参赛赛道     | 开源 AI 工具赛道                                                                      |
| 企业赛题     | 【开源 AI 工具赛道】百度地图赛题：基于地图开放能力的“15 分钟生活圈”智能体检与规划助手 |
| 负责人       | 韩庭轩                                                                                |
| 单位/学校    | 南京大学                                                                              |
| 其他团队成员 | 姜可                                                                                  |

## 三项提交材料

- **完整可运行源码**：[公开仓库](https://github.com/TingxuanHan/yike-yanhuo)；[固定版本](https://github.com/TingxuanHan/yike-yanhuo/tree/os2026-baidu-v3-20261016)。
- **作品介绍**：[6页PDF](../materials/yike-yanhuo-baidu-v3.pdf)；[可编辑文稿](submission-v3-brief.md)。内容聚焦项目背景、技术架构、应用场景与创新点，封面包含报名信息。
- **核心功能与使用流程演示**：[有声字幕视频](https://github.com/TingxuanHan/yike-yanhuo/releases/download/os2026-baidu-v3-20261016/yike-yanhuo-baidu-v3.mp4)；[字幕](../materials/yike-yanhuo-baidu-v3.srt)；[逐字稿](submission-v3-transcript.md)。

[全部附件及校验清单](https://github.com/TingxuanHan/yike-yanhuo/releases/tag/os2026-baidu-v3-20261016)。v1、v2保留作历史版本，本页链接为当前提交版。

## 运行

推荐Node.js 24，最低22.13。

```sh
npm ci
npm run build
npm start
```

打开 `http://127.0.0.1:8787`。不配置密钥也可使用构造示例；真实地图与在线AI需按`.env.example`配置自己的凭据。默认不附带真实AK、个人数据库或缓存。[微信配置](wechat-experience.md)、[服务部署](deployment.md)。

## 本次实际演示

上海市杨浦区抚顺路社区睦邻中心，2026-10-16 22:42至22:47（北京时间）实际调用百度地址解析、六类设施检索和步行测时。路线236条、检索6次，177个采样点、60处设施；无失败与重试，路线请求开始最小间隔1101ms。

视频保留真实API任务发起与执行片段；底图结果展示重开该轮刚生成的报告，中间等待剪短。日常出门与家人协助是构造街区演练，微信为开发者工具页面留档，均在章节标注。地图API结果不等同于现场实走真值。

原始输入与调用时间：[上海本轮报告](../materials/submission-v3-evidence/shanghai-analysis.json)、[脱敏用量记录](../materials/submission-v3-evidence/live-summary.json)。切换时长、个人条件与补点计算复用此报告。

配音采用系统预设普通话神经网络音色，未使用真人声音克隆。制作客户端参考[edge-tts项目文档](https://github.com/rany2/edge-tts)，没有启用付费语音模型；旁白和字幕文稿随源码保留。

## 材料重建与验证

```sh
python scripts/build-submission-v3.py
python scripts/verify-submission-v3-doc.py
python scripts/make-submission-voice-v3.py
python scripts/compose-submission-v3.py
```

PDF依赖ReportLab和中文字体，截图输入保存在`materials/submission-v3-assets/`。旁白脚本使用隔离目录`.cache/tts-deps`中的edge-tts。视频重编需要本轮原始录屏与配音缓存；发布视频可直接观看，不要求评审重新调用API录制。自动化媒体检查见[文档](validation/submission-v3-doc.json)与[视频](validation/submission-v3-video.json)。

仓库已公开，不需要邀请评审账号。未代发参赛邮件，未正式发布微信小程序。
