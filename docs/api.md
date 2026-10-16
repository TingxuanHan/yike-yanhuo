# 本地接口

## 定向补核查

`POST /api/verification/preview`接收`{result,category,minutes,taskIds}`。`result`为完整原报告，类别与时长必须属于当前报告，1至3个不同任务编号须由共享`verificationTasks`生成。返回`{fingerprint,plan}`，包含任务及带一次重试余量的`maxRouteUnits`/`maxSearchUnits`。预览不调用地图。

`POST /api/verification`在相同输入上增加`{fingerprint,requestId,confirmed:true}`，返回202和任务编号。`requestId`为8至80个字母、数字、下划线或连字符；同空间内相同编号/内容返回原任务，内容不同返回409。当前报告摘要变化、未确认、现场任务、超过容量、预算不足和已有真实地图任务都会在执行前拒绝。请求体上限2100000字节，原报告仍受2MB校验。

任务共用`GET/DELETE /api/analyses/:id`查询和取消，沿用外部部署设备鉴权、空间隔离与来源保护。最多保留8个任务、10分钟；最多2个运行任务且真实地图任务最多1个，网关中的测时、检索等服务API继续串行。任务幂等状态为内存记录，不保证跨重启；取消不退还已发出的上游用量。补查端点每个拥有者/来源地址每10分钟最多30次操作。

结果新编号并含`verification`来源/回执、`baseGeneratedAt`基础数据时间，以及最多12条`localSearches`。原全局`complete`不会因局部结果完整而提升。分区只采用每个完整查询分别缩入核查距离后的范围；来源冲突不证明覆盖。客户端明确采用前保存一组前后备份，Web可导出并用`npm run verify:repair -- 文件路径`离线校验。完整使用、字段边界及模拟/真实区别见[定向补核查](targeted-verification.md)。

## 实走校准记录

沿用`GET/PUT /api/life`，不新增地图或模型接口。`LifeBook.walks`为最多30条的可选字段，包含准备时固定的步速与历史引用、后补计时、距离来源和排除原因。严格校验字段并移除未声明数据，保留原有鉴权、私有空间隔离和版本409；旧地点簿兼容。合并冲突、有效条件与导出格式见[实走校准](walk-calibration.md)。

## 邻里提醒

以下接口在本机与公网都要求设备会话，Web使用会话cookie，小程序使用设备令牌。公开反馈与私人地点簿同步分开。

| 方法与路径 | 用途 |
| --- | --- |
| POST `/api/neighborhood/query` | 按目的地与可选的已有路线查询相关提醒，不保存查询轨迹 |
| POST `/api/neighborhood/events` | 明确同意分享后创建观察；相同类型和目标复用事件 |
| POST `/api/neighborhood/events/:id` | 带版本与请求编号更新或撤回本空间反馈 |

读接口上限160KB，写接口6KB；每空间每分钟120次查询、12次写入和每天40次共享操作，每日上限不阻止撤回本人反馈。冲突或重复编号携带不同内容返回409。查询最多返回50个相关事件并说明截断；结果不包含他人空间编号或设备令牌。观察时间、位置匹配、留存和原型边界见[邻里提醒](neighborhood-notices.md)。

## 分段步行步骤

`POST /api/outings/walking-guide`接收`{from,to}`，两者都是`OutingNode`（编号、名称、带坐标系的位置），必须属于真实场景且地点不同。返回`WalkingGuide`：版本、起终点、来源`baidu`、获取时间、米数、服务商参考秒数和最多80条文字步骤。只选择服务商第一条路线；去除指引HTML，拒绝缺失或不合法步骤，不填补虚构内容。完整且相接的服务商步骤可附带GCJ-02路径及各步起点供邻里提醒使用；路径缺失或断裂时仍返回文字步骤，不补画直线。

公网部署要求拥有者设备鉴权，沿用来源检查；与`outings/routes`共用40次／10分钟请求保护、24000字节请求上限、BaiduGateway串行队列及持久化额度。连接中断后取消排队请求。真实接口和字段说明见[分段步行指引](walking-guides.md)。最近6段指引及出门卡只存当前设备，不随地点簿同步，不进入家人位置卡。

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
| `POST /api/ai/parse` | `{mode:"free"或"own",text,requestId,current?}`，600字内文字，一次非流式请求。返回`{draft,source,model,changes}`，不生成路线或自动应用。带`current`时生成严格条件补丁，未提到的内容保留；无`current`时为初次提取。 |
| `GET /api/ai/voice` | 返回`configured,model,maxSeconds`，不发模型请求。仍要求已配对的私人空间。 |
| `POST /api/ai/voice` | `{mime,audio,requestId}`；base64编码的16k单声道PCM WAV或有效MP3，音频上限2MiB、界面最多45秒；返回`{text,model}`。每次查验准确ASR模型零元价格，30秒截止，共用模型单请求租约，无自动重试。 |

`draft`为白名单字段：`tripMinutes, shoppingBudget, departure, speedMps, walkingMinutes, returnEasy, tasks, items`。未提供的条件为null或空数组，文本商品必须来自用户原话；未知字段、错误类型和越界数据拒绝。页面允许用户修改及明确确认，再进入原有计算器。

`requestId`为12—80位字母、数字、下划线或连字符，同一设备重复ID在七天保留期内返回409，不重复调用。返回401表示需重新配对，429为本项目次数或并发限制，503为尚未配置，502/504为无有效条件或超时。失败也计入已预留次数；客户端不会自动重试。详见[用量与存储说明](planning-assistant.md)。

## 整趟行程和行后记录

整趟核算复用有向路线接口、现有商品记录、步行和营业时间计算，最多五个候选地点。进行中行程、事件和待编辑条件保存在当前设备，位置由使用者明确确认；不调用新的定位或后台跟踪接口。语音录音不进入设备草稿或服务器数据文件。

`book.trips`为可选数组，最多30条，字段为`id,date,mode,origin,completed,difficult,totalMinutes,walkingMinutes,meters,spent,note`。明确区分`demo`和`baidu`，纯步行分钟与实付金额可为null，难走地点必须来自已确认到达的集合。字段白名单和大小检查位于`trip-feedback.ts`。旧地点簿兼容；合并同编号保留本机记录，按日期保留最近30条，仍受整本750000字节上限约束。同步预览会显示行后记录数量。

`meters`是已确认路段的已知道路长度合计，不是GPS实测轨迹。只有符合条件的真实记录才可另经确认更新步速；音频、设备凭证和模型密钥不属于该结构。完整步骤见[一趟出门与语音](trip-and-voice.md)。

## 常用出门方案与本机卡片

`book.routines`为可选数组，最多8条。每条包含`id,name,savedAt,origin,stops,draft`，候选地点1—5个；`draft.departure`和`draft.speedMps`规范化为null，使用时填入当前时间与当前步速。不得重复地点或混合模拟与真实坐标。其他字段丢弃，沿用整本750000字节限制、同编号本机优先合并和版本冲突机制；Web与微信同步预览包含方案数量。

出门卡只存当前设备，不属于`book`或同步API。字段和500000字符限制见`src/shared/departure.ts`；Web导出独立HTML，不包含设备凭证、计算坐标或分享令牌。功能与离线边界见[常用方案与出门卡](departure-preparation.md)。

## 单次位置分享

| 接口 | 用途 |
| --- | --- |
| `POST /api/life/family` | 拥有者鉴权后提交`{snapshot:{record,speedMps}}`，返回`{view,invite}`。一小时到期；同一私人空间重新创建使旧卡失效。请求体上限3000字节。 |
| `GET /api/life/family/:id` | 拥有者读取自己分享的单次记录。 |
| `DELETE /api/life/family/:id` | 拥有者停止分享，重复撤销安全。 |
| `GET /api/family/:id` | 家人仅用`X-Yike-Family`令牌读取该卡。没有私人地点簿或付费接口权限。 |
| `POST /api/family/:id` | 同一专用令牌；提交`{revision,receipt:{id,kind,name}}`，只更新该卡最新回应。请求体上限1000字节，来源检查及独立20次/10分钟频率限制。 |

`record`只有`source,position,name,at,accuracyM`；source为`device|confirmed`，position为带`wgs84|gcj02|bd09`体系的经纬度，拒绝模拟点、无效经纬度与超过当前服务端时钟一分钟的未来时间。本人确认的精度字段强制为null；超过一天的记录不新建链接。`view`包含`id,createdAt,expiresAt,snapshot,revision,receipt`，旧记录可不带后两项，版本按1处理。手机号、设备凭证、历史轨迹和其他地点均不属于分享载荷。

`receipt.kind`只接受`seen|coming|calling`；称呼去除首尾空白后1—20字符，拒绝换行与尖括号，身份未核验。请求编号为12—80字符，最新回应的同编号同内容重试直接返回原结果；同编号异内容或过期版本返回409。新回应使用服务端时间`at`，版本加一。不会因GET产生回执，也不发送推送；家人令牌不能修改位置记录。撤销、替换与到期同时终止读取和回应并清除正文。

访问凭证为32字节随机数，服务端保存SHA-256散列；Web放在URL片段，家人请求省略Cookie、禁止重定向并使用`no-referrer`。微信接收页面仅将位置卡凭证发给链接中的服务地址，不发送本机设备凭证。接口沿用来源检查、独立频率限制、无缓存响应及过期正文清理。估算范围由客户端按记录年龄计算，公式与限制见[简易模式与家人位置线索](simple-family.md)。

## 单次行程协助

拥有者接口沿用私人空间设备鉴权；家人接口仅接受`X-Yike-Assist`能力令牌，不附带拥有者Cookie或Bearer。Web邀请将密钥放在URL片段中，家人请求省略Cookie、禁止重定向并使用`no-referrer`。微信邀请通过页面参数携带能力令牌和服务地址，请求只发给该地址，绝不附带本机私人空间的设备凭证。

| 接口 | 用途 |
| --- | --- |
| `GET /api/life/assistance` | 列出当前私人空间未结束的协助。 |
| `POST /api/life/assistance` | `{snapshot}`，创建1小时会话并仅在创建响应返回`{view,invite}`。同一行程限1个、同一空间限3个有效会话。 |
| `GET /api/life/assistance/:id` | 拥有者读取当前会话。 |
| `PUT /api/life/assistance/:id` | `{revision,snapshot}`，更新进度或明确选择的入口照片。快照变化递增`snapshotVersion`并使旧建议失效。 |
| `POST /api/life/assistance/:id/decision` | `{revision,proposalId,decision:"accepted"或"rejected"}`，拥有者确认处理建议；该接口只记录结果，行程修改由本人客户端核算并保存。 |
| `DELETE /api/life/assistance/:id` | 立即撤销能力令牌访问，清空会话正文。重复结束仍成功。 |
| `GET /api/assistance/:id` | 家人读取仅含本次行程信息的`AssistView`。 |
| `POST /api/assistance/:id` | `{revision,proposal}`，提交一条待确认建议；不直接修改地点簿或行程。 |

快照字段为`tripId,basis,mode,currentId,phase,confirmedAt,stops,homeId,remaining,speedMps,finish,request,guide`；最多6个地点，只包含名称及内部编号。`basis`用于客户端检测本机进度变化。建议包含`id,kind,helper,note,snapshotVersion,change,marker`；类型为`message|plan|entrance`，路线建议仅能选择当前剩余地点，坐标标记是图片内部0—1的归一化位置。所有载荷经过白名单清理与大小校验，格式定义见`shared/assistance.ts`。

版本冲突返回409，已结束或到期返回410，其他空间或错误能力令牌返回404；没有拥有者设备鉴权返回401。能力令牌使用32字节随机数、数据库仅存SHA-256散列。过期访问立即拒绝，清理任务清空正文，过期24小时后的记录删除。服务端沿用来源限制，并为协助读写设置独立请求频率保护，不更改百度或模型配额，也不调用这些服务。

`book.entrances`为可选数组，最多12张私人入口卡，字段为`id,name,photo,x,y,instruction,observedOn,source`。照片沿用已有压缩JPEG/PNG数据格式上限；`source`区分本人记录和家人建议，不构成现场核验。入口卡计入750000字节整本限制，合并同编号保留本机卡，容量溢出时拒绝合并而保留原数据。进行中的协助、邀请密钥及电话不随地点簿同步。
