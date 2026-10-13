# 本地接口

所有计算端点只接受结构化输入，不接受任意上游 URL。默认监听本机，API响应不包含 AK。

外部部署配置`PUBLIC_ORIGIN`后，除健康、公开配置、创建空间和兑换配对码外，所有`/api/`端点都需要设备会话。Web由HttpOnly cookie承载；小程序使用`Authorization: Bearer <设备令牌>`。令牌只对应本服务，不是百度AK。分析任务和私人报告按空间隔离。

| 方法与路径 | 用途 |
| --- | --- |
| GET `/api/health` | 存活状态与版本 |
| GET `/api/config` | 地图和分析服务是否已配置；不返回密钥 |
| POST `/api/geocode` | 输入 `address`，返回BD-09经纬度、精确匹配标记和置信信息 |
| POST `/api/convert` | 输入 `geo:{lng,lat}` 和 `from:1`（GPS）或`3`（GCJ-02），返回BD-09 |
| POST `/api/analyses` | 创建体检任务，返回 `id` |
| GET `/api/analyses/:id` | 任务状态、阶段进度与结果 |
| DELETE `/api/analyses/:id` | 取消任务并清除其结果 |
| POST `/api/outings/routes` | 有向地点对的步行测量，每次最多12个地点和6段路线；见下方说明 |
| GET `/api/map-sdk/*` | 受限地图绘制资源代理，不代理地点或算路接口 |

模拟请求：

```json
{"mode":"demo","label":"里巷中心","point":[-400,0]}
```

真实请求使用 `mode:"baidu"`、`geo:{lng,lat}` 与可选 `label`，不得把经纬度放入模拟米制坐标。地址定位后应先在地图上核验中心，不能把低精度地理编码当作已确认入口。

`address`去除首尾空白后至少2个字符，UTF-8编码不超过128字节（约42个汉字）。输入不合法时返回400，且不调用上游服务。

地图SDK加载前先检查应用权限，失败时不继续下载SDK，结果缓存两分钟。代理根路径只允许`verify`、`business`、`custom_hd`、`cen`等必要显示元数据；`jsapi_log`在本地返回204。地点检索和步行分析不能借此绕过预算。

返回结果的 `contours` 是局部米制多多边形，保留孔洞和独立片区；地理基准位于 `center.geo`。`samples` 保留有效、未知、不可达状态。`complete` 表示本次关键词检索返回结果是否在分页限制内取完，不表示现实设施绝对完整。

`gaps` 的缺口口径为可达采样点周边1公里直线距离。`missing` 是未检索到候选设施；`unknown` 是范围覆盖或检索完整性不足。界面不把两者合并。

`usage.routePairs` 包含实际发出的路线对及重试；`usage.requests` 是服务请求数，两者不可互换。账户配额记录和浏览器地图资源数在本地额度文件中单独统计。
## 本地用量接口

`GET /api/quota` 返回北京时间日期、四类本地已用计数和配置预算，不请求百度服务。完整真实体检启动前预留单次最大路线数与6类检索页数对应的预算；不足时不启动任务。计数不能代替百度控制台账户用量。

## 日常出行与私人空间

| 方法与路径 | 输入 / 结果 |
| --- | --- |
| POST `/api/personalize` | `result`为有效报告，`preferences`为共享出行偏好；返回试算报告，不调用百度 |
| POST `/api/life/create` | `client:web或mini`，外部部署另需`invite`；创建独立私人空间并返回`snapshot` |
| POST `/api/life/redeem` | `code`与`client`；兑换一次性配对码，加入已有空间并返回`snapshot` |
| GET `/api/life` | 返回`revision, updatedAt, book`；`book`包含格式标记、偏好和最多200个个人地点 |
| PUT `/api/life` | `revision, book`；版本不一致返回409且不修改数据库 |
| POST `/api/life/pair` | 返回`code, expiresAt`；5分钟有效、一次使用，新码作废旧码 |
| DELETE `/api/life/session` | 撤销当前设备会话；不删除其他设备或地点簿 |
| GET `/api/life/reports` | 当前空间的最多5份报告摘要 |
| POST `/api/life/reports` | `result`；上传经过白名单验证的有效报告 |
| GET `/api/life/reports/:id` | 获取所属空间的报告；其他空间返回404 |
| DELETE `/api/life/reports/:id` | 移除当前空间的报告 |

仅当`client=mini`时，创建/兑换响应额外返回设备`token`；Web通过cookie获得会话。服务端不记录令牌明文。配对代表对整个私人空间的读写权限，不是只读分享。

共享数据类型与边界验证见`src/shared/life.ts`和`journey.ts`。个人地点强制`source:personal`、明确`position.system`，并保留上次到访日期及入口地标。未知字段丢弃，重复编号、非法坐标、超量记录整批拒绝。

试算报告仍兼容`schemaVersion:1`，增加`scenario:{preferences,sourceId,createdAt}`，有效测时保存可选`recordedSeconds`。原5/10/15分钟报告保持兼容；个性化报告使用5分钟、10分钟及用户目标时长中不超过目标的去重阈值。原数据时间及调用统计不变，表示获取基础数据的成本。

## 单地点只读卡片与照片

| 方法与路径 | 权限 / 输入 / 结果 |
| --- | --- |
| POST `/api/life/cards` | 设备会话；`place`经过地点校验；返回`id, token, expiresAt`，201 |
| GET `/api/life/cards` | 设备会话；仅返回本空间有效卡片摘要，不返回分享令牌 |
| DELETE `/api/life/cards/:id` | 设备会话；只允许撤销本空间卡片 |
| GET `/api/card` | 无需设备会话；通过`X-Yike-Card`传入32字符分享令牌；返回单地点副本与创建、到期时间 |

分享令牌与设备令牌独立，数据库仅存哈希；七天到期，单空间最多20张有效卡。无效、到期或已撤销返回404；不能用分享令牌读取地点簿、分析接口或其他卡片。响应`Cache-Control:no-store`。浏览器分享把令牌放在URL片段，读取时只发送专用请求头；小程序卡片读取不携带设备令牌，也不改变原服务地址。日志与截图不应记录有效分享令牌。

个人地点增加可选`favorite:boolean`、`openingHours:string`（120字符）和`photo`。照片仅允许JPEG/PNG的base64数据URI，最长64000字符；不允许远程URL或SVG。整个规范化地点簿UTF-8 JSON上限750000字节，旧无照片数据继续兼容。卡片副本去除私人收藏标记。

## 办事、熟路与休息点

`POST /api/outings/routes`输入`nodes:[{id,name,position}]`、`pairs:[[fromId,toId]]`。起终点必须存在且不同，禁止重复编号、重复方向对以及混用模拟与真实坐标。位置支持`demo`米制位置，或带显式`bd09/gcj02/wgs84`声明的地理坐标。请求体最大24KB，每次最多12个地点、6个有向路段。

返回`nodes,edges:[{from,to,travel}],mode,generatedAt,usage`。模拟路段来自共用示例路网；真实路段先转换坐标，再通过既有串行BaiduGateway请求步行矩阵。公开部署要求设备会话，单设备或本机请求来源最多40次/10分钟。含重试余量的路线或坐标转换预算不足返回429；请求中断会终止后续排队操作。`usage`记录该批矩阵读取，坐标转换实际消耗另计入`GET /api/quota`的`other`，不要仅用`usage.requests`估计全部成本。

`book`增加两个可选数组：`familiarRoutes`最多12条，字段为`id,name,checkedOn,steps:[{title,instruction,photo?}]`；每条2—8步，照片规则与个人地点一致。`restPoints`最多30条，字段为`id,name,position,checkedOn,validUntil,note`，核验日期不能晚于今天，有效期不超过90天。仍使用`yike-life-v1`和750000字节总上限，旧无新字段的文件可读取。当前两端合并同时保留这两类记录，同编号冲突保留本机值。

办事顺序、营业等待、休息规划及补点计算在两端共用`src/shared/outings.ts`，不是新的百度接口。算法及受限候选含义见[出门办事](outings.md)。

## 购物记录与预算

`book.shopping`是可选对象，包含`items,options,prices,blocked`。`items`最多5项，保存名称、规格、单位、品牌、1—99整数数量和是否接受其他品牌；`options`保存金额、整趟时间、最多到店数、额外时间、停留与休息条件。`prices`最多150条，每条包含`id,store,product,kind,low,high,observedOn,validDays,stock,source,liked`。`kind`为商品单价、每人或每次消费参考；价格两端同为`null`表示未知。日期不得在未来，参考期1—90天，金额至多两位小数。`blocked`最多100个标准商品标识。

旧地点簿不需要该字段。继续使用原有私人空间API、版本检查与整本750000字节上限；白名单校验丢弃额外字段。手动合并保留本机清单和预算，价格按编号合并且同编号本机优先，排除偏好取并集。

购物算法在两端共用`src/shared/shopping.ts`，真实路线复用`POST /api/outings/routes`；无新增百度数据源或价格查询接口。先验证候选、清单与可比记录，再读取最多30个有向路段；未知价格不计为完整报价。详细限制见[顺路好买](shopping.md)。

## 步行节奏偏好

`book.movement`为可选对象：`mode:easy|alternating`、`easyMps,briskMps,targetMinutes,maxExtraMinutes,warmMinutes,briskMinutes,recoverMinutes,returnEasy,continuousMinutes`。数值范围与字段白名单见`src/shared/movement.ts`；交替模式的稍快步速必须高于轻松步速。旧地点簿兼容，仍使用原空间API、版本冲突机制和总大小限制，手动合并优先保留本机步行偏好。

已选行程快照与未保存设置仅留在设备本地，快照包含有向距离、地点名称、出发偏好和营业／歇脚信息，不包含坐标。核心`planMovement`与两端共用`MovementSession`无网络依赖，不产生已完成运动记录；运动计算没有新增百度接口。可选的模型条件提取接口如下。

## 条件整理与模型设置

以下接口在本机模式也需要有效设备凭证：Web使用HttpOnly会话Cookie，微信使用既有Bearer设备令牌；所有写请求沿用来源与JSON检查。

| 接口 | 用途 |
| --- | --- |
| `GET /api/ai/status` | 返回基础AI是否配置、模型、空间今日余量；当前设备自用配置的地址/模型/余量及北京时间重置时刻。永不返回密钥。 |
| `PUT /api/ai/settings` | `{baseUrl, model, key}`，完整保存当前设备的加密配置，不发模型请求。 |
| `DELETE /api/ai/settings` | 删除当前设备的配置，保留当日用量计数。 |
| `POST /api/ai/parse` | `{mode:"free"或"own",text,requestId}`，600字内文字，一次非流式请求。返回`{draft,source,model}`，不生成路线或自动应用。 |

`draft`为白名单字段：`tripMinutes, shoppingBudget, departure, speedMps, walkingMinutes, returnEasy, tasks, items`。未提供的条件为null或空数组，文本商品必须来自用户原话；未知字段、错误类型和越界数据拒绝。页面允许用户修改及明确确认，再进入原有计算器。

`requestId`为12—80位字母、数字、下划线或连字符，同一设备重复ID在七天保留期内返回409，不重复调用。返回401表示需重新配对，429为本项目次数或并发限制，503为尚未配置，502/504为无有效条件或超时。失败也计入已预留次数；客户端不会自动重试。详见[用量与存储说明](planning-assistant.md)。
