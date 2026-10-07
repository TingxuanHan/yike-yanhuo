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
