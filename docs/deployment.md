# 安装、运行与部署

## 本地运行

推荐 Node.js 24，最低22.12。首次安装：

```sh
npm ci
```

不配置密钥也可运行模拟街区：

```sh
npm run dev
```

浏览器访问 `http://127.0.0.1:5173`。开发服务包含前端5173端口和分析服务8787端口。按 Ctrl+C 停止。

真实地图配置见 [百度地图开通说明](baidu-setup.md)。复制 `.env.example` 为 `.env`，填入两种 AK；修改后重启服务。

## 构建与生产预览

```sh
npm run build
npm start
```

访问 `http://127.0.0.1:8787`。生产服务同时提供网页和分析接口。默认仅本机可访问。

## 自动验证

```sh
npm run check
npm test
npm run build
npm run test:ui
```

Windows 浏览器测试使用已安装的 Microsoft Edge；Linux/macOS 使用 `npx playwright install chromium` 安装测试浏览器。CI另行安装系统依赖。

测试使用合成道路和接口契约，不读取真实 AK、不调用百度服务。真实实测是独立的手动命令：

```sh
node --env-file=.env scripts/live-check.mjs --run
```

实测先做地址、单条路线与坐标转换预检，再开展一轮分析。单轮路线预算260条，每日实测预算500条路线、12次地点检索；默认每次1条路线、至少间隔1100毫秒，检索至少间隔2000毫秒，所有业务请求串行。任何预检失败会停止后续阶段。摘要和本次主动保存的结果位于本地 `.cache/`，不进入 Git。开启界面后无需重复实测脚本；已有成功结果时优先复用，不反复消耗额度。

底图联调另行执行`node --env-file=.env scripts/map-check.mjs --run`，须先启动本地生产预览。单次限制30个代理资源请求，并阻止分析接口调用；浏览器请求、页面及本地文本响应均检查密钥回显。权限错误先核对AK与应用类型的对应关系，再检查控制台限制，不要反复重跑。

## 材料复现

`materials/`提供作品介绍PDF、技术报告PDF与模拟流程录像。PDF排版源为`scripts/build-materials.py`：

```sh
python -m pip install -r scripts/requirements-materials.txt
python scripts/build-materials.py
```

Windows默认使用本机微软雅黑；其他系统通过`--font-regular`和`--font-bold`指定支持中文的TrueType字体。生成后应渲染检查全部页面。更新真实联调状态时，同时维护Markdown报告和PDF排版源。

视频由`node scripts/record-demo.mjs`录制，单独启用无密钥的8790端口服务并阻断外部请求。首次录制需把`PLAYWRIGHT_BROWSERS_PATH`设置为项目下的`.cache/playwright`后运行`npx playwright install ffmpeg`。Windows使用本机Edge；其他系统还需安装Chromium。成片为带说明字幕、无配音的WebM初版，最终参赛版需补齐真实案例和口头讲解。

## 配额、进程与保存

- `.cache/baidu-quota.json` 只存北京时间日期和调用计数，不含 AK。请求发出前记账，失败也计入预算，取保守口径。
- `.cache/baidu-requests.jsonl`记录实际业务请求的发出时间、服务类别、固定接口路径、计量单位和数值状态码；不保存AK、查询参数、地址或上游错误原文。旧版没有逐请求时间，不能反推其精确峰值。
- 不要在同一数据目录同时运行多个服务实例。本轮持久化预算是单进程实现，不是跨机器配额服务。
- 重启不清零当天计数；不要通过删除配额文件反复消耗账户额度。平台控制台统计包含其他程序的调用，仍是最终依据。
- 正常分析结果仅在内存保存10分钟，最多保留8个任务。用户主动导出的文件自行保管。
- 两分钟缓存最多128项上游结果，地图资源缓存最多64项。未缓存时重试也计入实际路线和请求预算。
- HTTP 429及业务额度/并发错误触发本进程停止后续真实业务调用；仅网络异常和HTTP 5xx最多重试一次。限流保护需先核对控制台后再重启，不能用反复重启规避限制。
- 旧配置中的`BAIDU_ROUTE_QPS=3`需要改为`1`；建议同步采用`.env.example`的500条路线、12次检索日预算。现有AK无需更换或再次发送。

## Docker 部署配置

已提供 Dockerfile；本地未运行 Docker 构建验证。

```sh
docker build -t yike-yanhuo .
docker run --rm --env-file .env -e HOST=0.0.0.0 -p 127.0.0.1:8787:8787 -v yike-budget:/app/.cache yike-yanhuo
```

若需对外提供演示，应在反向代理层加入访问认证和整体限流，配置 HTTPS 与 `PUBLIC_ORIGIN=https://实际演示域名`，并更新百度控制台白名单。当前版本用于单机开发和受控评审演示，未实现多租户账号、分布式配额和公开服务防滥用体系。

## Windows Git 连接

本次开发遇到受限终端下 `git-remote-https.exe` 崩溃。相同客户端与凭据在正常用户终端的 push/fetch 均通过，后续远程同步使用正常用户环境。项目本机配置采用 OpenSSL 和已有本地代理，只写入 `.git/config`，不作为所有用户的通用网络设置。

若 Git 因文件创建者不同提示 dubious ownership，可在确认当前目录来源后，对单次命令使用 `git -c safe.directory="项目绝对路径" status`。不要添加全盘通配信任。切换网络环境时按实际情况移除本仓库代理设置；不需要关闭 TLS 校验。
