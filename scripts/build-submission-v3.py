"""Create a focused six-page competition introduction from the current evidence."""
from pathlib import Path
import importlib.util, json, re
from datetime import datetime
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('layout',ROOT/'scripts/build-submission.py')
b=importlib.util.module_from_spec(spec);spec.loader.exec_module(b)
REPO='https://github.com/TingxuanHan/yike-yanhuo'
TOPIC='【开源 AI 工具赛道】百度地图赛题：基于地图开放能力的“15 分钟生活圈”智能体检与规划助手'

def build():
    result=json.loads((ROOT/'materials/submission-v3-evidence/shanghai-analysis.json').read_text(encoding='utf-8'))
    live=json.loads((ROOT/'materials/submission-v3-evidence/live-summary.json').read_text(encoding='utf-8'))
    d=b.Book(ROOT/'materials/yike-yanhuo-baidu-v3.pdf',total_pages=6,md_output='docs/submission-v3-brief.md')
    d.c.setTitle('一刻烟火｜作品介绍');d.c.setAuthor('韩庭轩、姜可｜南京大学')
    d.md=['# 一刻烟火：作品介绍','','项目背景、技术架构、应用场景与创新点。2026-10-16。','']

    d.page('一刻烟火','2026 上海开源软件应用创新大赛 · 参赛作品')
    d.img('materials/wechat-avatar-v8-512.png',width=137,x=b.M,top=135)
    d.p('从家门口，走进好生活。',x=205,top=153,width=340,size=20,leading=30)
    d.p('15 分钟生活圈<br/>智能体检与规划助手',x=205,top=198,width=340,size=15,leading=24,color=b.GREEN)
    d.y=305
    d.table(['报名信息','内容'],[
      ['项目名称','一刻烟火'],['参赛赛道','开源 AI 工具赛道'],['企业赛题',TOPIC],
      ['负责人','韩庭轩'],['单位/学校','南京大学'],['其他团队成员','姜可']
    ],[1.2,4.5],size=10,leading=17)
    d.p('沿真实道路计算步行范围，发现生活设施与待核查缺口；<br/>将个人时间、步速和家人协助，接到一次具体的出门安排。',size=11.5,leading=20)
    d.p(f'完整源码：<link href="{REPO}" color="#176c60">{REPO}</link>',size=9.5,leading=16)

    d.page('十五分钟，能满足哪些日常？','01 · 项目背景与应用场景')
    d.p('社区服务是否便利，取决于居民沿道路实际能走到哪里。跨河绕行、街区出入口与个人步速，都会让“直线很近”和“步行可达”出现差别。设施检索的空白，也可能只是资料没有查全。',size=11,leading=19)
    d.table(['使用者','具体问题','一刻烟火提供的操作'],[
      ['社区工作者','哪些服务覆盖不足？','选社区 → 看步行范围与六类设施 → 查三类必需设施覆盖 → 补查或比较补点'],
      ['日常出门的居民','这趟能否按时办完？','按步速和时长试算 → 组合买菜、取药等任务 → 核算停留、等待与返程'],
      ['长者与家人','不会操作或找不到入口怎么办？','简易模式、大字地点卡、入口记录；主动发起家人协助，由本人确认建议']
    ],[1.05,1.35,3.3],size=9.6,leading=16)
    d.img('materials/submission-v3-assets/range.png')
    d.p('上海抚顺路社区：本次实际调用百度地图生成的步行范围与设施结果，保留地图来源标识。',size=8.5,leading=14,color=b.MUTED)

    d.page('地图能力与规划逻辑如何连接','02 · 技术架构')
    d.p('Web 与微信原生小程序共用计算模型和服务接口。地图测时提供路由依据，确定性算法负责核算与比较；AI 负责把自然语言整理成可修改、待确认的出行条件。',size=11,leading=19)
    d.flow([
      ('交互层：Web ＋ 微信原生小程序','React / TypeScript；微信 JS、WXML、WXSS；地图、地点簿、简易模式与家人协助。'),
      ('共享计算层：生活圈与整趟规划','采样与边界加密 → 等时圈；设施证据 → 连续覆盖；补点比较；往返、价格记录与步速核算。'),
      ('服务层：Node.js ＋ SQLite','设备配对、私人空间、版本冲突保护；限流队列、缓存、每日预算、取消与结果保存。'),
      ('能力层：百度地图 ＋ 可选语音 / AI','地址解析、坐标转换、周边检索、步行路线和底图；语音转文字与结构化条件解析。')
    ])
    d.h('接口用得深，也要用得省')
    d.p('81 点规则采样，最多增加 96 个边界点，优先细化时间阈值附近的网格；共享边只测一次。路线串行、缓存去重、执行前预检预算，失败结果保留未知。时长切换、个人试算与补点比较复用已有数据。',size=10.5,leading=18)
    d.note('自有代码采用 MIT 许可；仓库包含锁文件、依赖许可清单、贡献与安全说明、测试及 CI。真实密钥仅在本地或服务端配置，源码与演示不附带凭据。')

    d.page('让体检结论可以解释，也能行动','03 · 核心创新')
    d.table(['常见做法的不足','本项目的实现与价值'],[
      ['用直线圆代表生活圈','沿真实步行路线测时，结合阈值附近自适应加密生成近似等时圈，保留断片、空洞与未知区域。'],
      ['没搜到设施，就判为缺口','区分已有覆盖证据、候选缺口与资料不足；记录检索范围与时间；把不足转成有预算预览的定向补查任务。'],
      ['只推荐一个补点位置','选择1至3处已测候选点，比较最多7种方案，扣除覆盖重叠；再比较不同步速、等灯假设下的共同补足区域。'],
      ['模型直接给一个出行答案','语音先转成可编辑文字，AI只提出条件草稿；本人确认后，由路由与约束核算时间、返程和预算。']
    ],[1.5,4.2],size=10,leading=17)
    d.h('同一个判断，留下可核对的依据')
    d.flow([
      ('先区分：缺设施，还是缺数据？','在地图与报告中查看连续覆盖分区、采样点依据和原始检索时间。'),
      ('再比较：补哪里，对谁有帮助？','相同新增数量之间比较收益；三种出行条件检查方案是否稳定，资料不足不计为确定收益。'),
      ('最后验证：另取固定点做接口复核','先冻结预测，再读取分离点位的步行测时；导出误判、漏判和未知，供独立脚本复算。')
    ])

    d.page('上海社区，实际调用地图接口','04 · 本次实际 API 演示')
    date=datetime.fromisoformat(result['generatedAt'].replace('Z','+00:00')).astimezone().strftime('%Y-%m-%d %H:%M')
    d.p(f'地点：{result["center"]["label"]}<br/>流程：输入地址 → 百度地址解析 → 设施检索与逐批步行测时 → 查看5 / 10 / 15分钟 → 覆盖核查与个人条件对比。',size=11,leading=19)
    d.img('materials/submission-v3-assets/coverage.png')
    rows=[]
    for c in result['contours']:
        known=[p for p in result['facilities'] if p.get('travel',{}).get('status')=='ok' and p['travel']['seconds']<=c['minutes']*60]
        rows.append([f'{c["minutes"]}分钟',f'{c["areaKm2"]:.2f} km²',f'{len(known)}处'])
    d.table(['步行时长','近似可达面积','本次检索且测时可达设施'],rows,[1,1.4,2.8],size=10,leading=16)
    d.p(f'记录时间：{date}（北京时间）。本轮实际消耗路线 {live["quotaDelta"]["route"]} 条、检索 {live["quotaDelta"]["search"]} 次；请求开始最小间隔 {live["minimumStartIntervalMs"]} ms。原始报告与用量记录随源码保存，可复算。',size=9.5,leading=16)
    d.note('这是实际地图 API 的测时与检索结果，不是现场实走真值。关键词检索可能不完整，实际入口、开放状态与通行条件仍需核实。视频将本段与后续构造街区演练分别标明。')

    d.page('体检之外，接到一趟安心出门','05 · 日常使用与双端体验')
    d.p('普通用户从“我要出门”开始，复杂条件按需展开。社区体检保留完整工作台，长者可以使用简易模式和大字指引。',size=11,leading=19)
    d.table(['实用场景','已经实现的功能'],[
      ['顺路办事与购物','多任务往返；停留与营业等待；根据私人价格、规格和库存记录比较少走、少花与均衡方案；价格不足明确提示。'],
      ['记住地图外的小店','私人地点簿记录坐标、入口、照片、地标与到访时间；生成地点卡，个人记录不自动变成已核验公共设施。'],
      ['长者与家人协作','大字、电话入口和短时远程建议；主动位置分享；旧记录带时间与估计范围，建议由本人确认。'],
      ['出门顺便动一动','在选定路线安排轻快交替、歇脚与返程；实走记录至少3条有效样本后才建议步速，采用前本人确认。']
    ],[1.3,4.4],size=9.7,leading=16)
    top=d.y
    for i,p in enumerate(['docs/images/simple-home-mini.png','docs/images/trip-mini-result.png','docs/images/family-location-mini.png']):
        d.img(p,width=133,height=228,x=b.M+i*181,top=top)
    d.y=top+240
    d.p('微信原生开发者工具页面留档。有服务器时，Web与小程序共用私人空间并通过设备配对同步；微信尚未正式上线，新增流程仍需手机验收。',size=8.5,leading=14,color=b.MUTED)
    d.p('可运行、可验证：推荐 Node.js 24；npm ci → npm run build → npm start。已有244项业务/API/原生页面测试与44项浏览器流程，构建及CI通过。代码仓库同时提供零密钥构造示例。',size=9.5,leading=16)
    d.p('百度评分对应：功能正确性与覆盖率40% · API深度调用与工程优化30% · 产品交互与用户体验15% · 开源工程规范15%。',size=8.5,leading=14,color=b.MUTED)
    d.save()
    p=ROOT/'docs/submission-v3-brief.md';t=p.read_text(encoding='utf-8')
    t=re.sub(r'<link href=[\'\"]([^\'\"]+)[\'\"][^>]*>(.*?)</link>',r'[\2](\1)',t)
    p.write_text(t,encoding='utf-8')
    print(json.dumps({'pdf':'materials/yike-yanhuo-baidu-v3.pdf','pages':6,'registrationIncluded':True},ensure_ascii=False))

if __name__=='__main__':
    pdfmetrics.registerFont(TTFont('Body','C:/Windows/Fonts/msyh.ttc',subfontIndex=0))
    pdfmetrics.registerFont(TTFont('BodyBold','C:/Windows/Fonts/msyhbd.ttc',subfontIndex=0))
    pdfmetrics.registerFontFamily('Body',normal='Body',bold='BodyBold',italic='Body',boldItalic='BodyBold')
    build()
