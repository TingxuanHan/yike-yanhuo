"""Build the project introduction and technical report from the release brief."""

from __future__ import annotations

import argparse
import os
from pathlib import Path
from xml.sax.saxutils import escape

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas
from reportlab.platypus import Paragraph
from reportlab.lib.utils import ImageReader

ROOT = Path(__file__).resolve().parents[1]
W, H = A4
MARGIN = 46
CONTENT = W - MARGIN * 2
INK = colors.HexColor("#193c45")
GREEN = colors.HexColor("#0d7063")
LIGHT = colors.HexColor("#eef5f1")
MUTED = colors.HexColor("#607c80")
LINE = colors.HexColor("#d7e3de")
ORANGE = colors.HexColor("#ce673a")
DATE = "2026.10.05"
REPO = "https://github.com/TingxuanHan/yike-yanhuo"


class Document:
    def __init__(self, path: Path, title: str, total: int):
        self.canvas = canvas.Canvas(str(path), pagesize=A4, pageCompression=1)
        self.canvas.setTitle("一刻烟火 - " + title)
        self.canvas.setAuthor("一刻烟火项目组")
        self.canvas.setSubject("15分钟生活圈智能体检与规划助手，版本0.1.0")
        self.title = title
        self.total = total
        self.page_number = 0

    def text(self, text, x, top, size=11, font="Body", color=INK):
        self.canvas.setFillColor(color)
        self.canvas.setFont(font, size)
        self.canvas.drawString(x, H - top - size, text)

    def para(self, text, top, x=MARGIN, width=CONTENT, size=10.5, leading=17, color=INK):
        style = ParagraphStyle(
            "body", fontName="Body", fontSize=size, leading=leading,
            textColor=color, wordWrap="CJK", splitLongWords=True,
        )
        p = Paragraph(text, style)
        _, height = p.wrap(width, H)
        if top + height > H - 49:
            raise ValueError(f"Page {self.page_number} overflows at {text[:30]}")
        p.drawOn(self.canvas, x, H - top - height)
        return top + height

    def line(self, top, x=MARGIN, width=CONTENT):
        self.canvas.setStrokeColor(LINE)
        self.canvas.setLineWidth(0.6)
        self.canvas.line(x, H - top, x + width, H - top)

    def page(self, subtitle=None):
        if self.page_number:
            self.canvas.showPage()
        self.page_number += 1
        self.text("一刻烟火", MARGIN, 26, 11, "Bold", GREEN)
        self.text(self.title + "  /  v0.1.0", W - 208, 28, 8.5, color=MUTED)
        self.line(50)
        self.line(H - 39)
        self.text("首版材料 · " + DATE, MARGIN, H - 30, 8, color=MUTED)
        self.text(f"{self.page_number:02d} / {self.total:02d}", W - 78, H - 30, 8, color=MUTED)
        if subtitle:
            self.text(subtitle, MARGIN, 73, 24, "Bold")
        return 123

    def section(self, title, top, number=None):
        if number:
            self.text(number, MARGIN, top + 1, 10, "Bold", GREEN)
        self.text(title, MARGIN + (29 if number else 0), top, 14, "Bold")
        return top + 29

    def note(self, text, top, color=GREEN):
        style = ParagraphStyle("note", fontName="Body", fontSize=10, leading=16, textColor=INK, wordWrap="CJK")
        p = Paragraph(text, style)
        _, height = p.wrap(CONTENT - 28, H)
        self.canvas.setFillColor(LIGHT)
        self.canvas.rect(MARGIN, H - top - height - 24, CONTENT, height + 24, fill=1, stroke=0)
        self.canvas.setFillColor(color)
        self.canvas.rect(MARGIN, H - top - height - 24, 3, height + 24, fill=1, stroke=0)
        p.drawOn(self.canvas, MARGIN + 14, H - top - height - 12)
        return top + height + 24

    def table(self, headers, rows, widths, top, font_size=9.5):
        y = top
        for i, row in enumerate([headers] + rows):
            paragraphs = []
            heights = []
            for value, width in zip(row, widths):
                style = ParagraphStyle("cell", fontName="Bold" if i == 0 else "Body", fontSize=font_size,
                                       leading=15, textColor=colors.white if i == 0 else INK, wordWrap="CJK")
                p = Paragraph(str(value), style)
                _, height = p.wrap(width - 18, H)
                paragraphs.append(p)
                heights.append(height)
            row_height = max(heights) + 18
            if y + row_height > H - 49:
                raise ValueError(f"Table overflow on page {self.page_number}")
            self.canvas.setFillColor(GREEN if i == 0 else (LIGHT if i % 2 else colors.white))
            self.canvas.rect(MARGIN, H - y - row_height, CONTENT, row_height, stroke=0, fill=1)
            x = MARGIN
            for p, width, height in zip(paragraphs, widths, heights):
                p.drawOn(self.canvas, x + 9, H - y - 9 - height)
                x += width
            y += row_height
            self.line(y)
        return y

    def crop(self, path, x, top, width, crop):
        """Place a clipped screenshot without changing its source pixels."""
        reader = ImageReader(str(path))
        iw, ih = reader.getSize()
        left, upper, cw, ch = crop
        scale = width / cw
        height = ch * scale
        c = self.canvas
        c.saveState()
        clip = c.beginPath()
        clip.rect(x, H - top - height, width, height)
        c.clipPath(clip, stroke=0)
        c.drawImage(reader, x - left * scale, H - top - (ih - upper) * scale,
                    width=iw * scale, height=ih * scale, mask="auto")
        c.restoreState()
        c.setStrokeColor(LINE)
        c.rect(x, H - top - height, width, height, fill=0, stroke=1)
        return top + height

    def save(self):
        if self.page_number != self.total:
            raise ValueError("Unexpected page count")
        self.canvas.save()


def introduction(path: Path):
    d = Document(path, "作品介绍", 3)
    d.page()
    d.text("一刻烟火", MARGIN, 78, 46, "Bold")
    d.text("15分钟生活圈智能体检与规划助手", MARGIN, 143, 18)
    d.para("把日常，放回步行尺度。<br/>从社区入口出发，看见步行可达的生活服务，并留下可以复核的核查线索。", 189,
           size=12, leading=20)
    bottom = d.crop(ROOT / "docs/images/workbench-desktop.png", MARGIN, 256, CONTENT,
                    (350, 110, 980, 700))
    d.para("图1　桌面工作台局部。人工构造的道路与设施，仅用于功能演示和回归验证。", bottom + 10,
           size=8.5, leading=13, color=MUTED)
    y = bottom + 58
    for x, main, caption in [
        (MARGIN, "5 / 10 / 15", "分钟近似步行范围"),
        (MARGIN + 175, "6 类", "日常生活服务设施"),
        (MARGIN + 347, "可复核", "参数、来源与调用记录"),
    ]:
        d.text(main, x, y, 23, "Bold", GREEN)
        d.text(caption, x, y + 38, 9, color=MUTED)
    d.para("版本0.1.0已具备模拟体检、接口适配、地图交互及报告导出。上海案例等待服务权限启用后继续联调。",
           y + 85, size=10, leading=16)

    y = d.page("从一个入口，到一份体检")
    d.para("居民、社区工作者与规划学习者都可以使用同一流程：选择位置，了解服务，再判断哪些地点值得实地核查。", y)
    steps = [
        ("01  选择起点", "输入社区地址或百度坐标，在地图上调整到实际入口。无密钥时可先使用模拟街区。"),
        ("02  计算步行范围", "沿路网获取采样点的步行时间，构建5、10、15分钟近似轮廓；显示有效测时点和边界截断提示。"),
        ("03  查看生活服务", "筛选菜市场、药店、小学、医疗、公园和养老设施。时长与图层切换复用已有结果。"),
        ("04  形成核查线索", "在15分钟可达采样点检查周边1公里设施覆盖；检索不全的点位标为待核查。"),
        ("05  保存与复核", "导出结构化JSON，或打印体检报告；保留中心、参数、来源、异常提示与调用统计。"),
    ]
    sy = 193
    for title, body in steps:
        d.text(title, MARGIN, sy, 12, "Bold", GREEN)
        d.para(body, sy + 25, width=270, size=10.5, leading=17)
        sy += 102
    bottom = d.crop(ROOT / "docs/images/workbench-mobile.png", 352, 193, 197,
                    (8, 924, 374, 660))
    d.para("图2　手机端结果局部。<br/>切换到河畔模拟起点后的实际截图。", bottom + 13,
           x=352, width=197, size=8.5, leading=14, color=MUTED)
    d.para("界面提供地图缩放、设施详情、覆盖核查点和独立报告视图。手机端先呈现主要操作，次要图层选项可以折叠。",
           bottom + 72, x=352, width=197, size=10, leading=17)
    d.note("统计口径：设施计数依据起点到设施的步行耗时；“周边1公里”依据直线距离，两者在报告中分别说明。", 715)

    y = d.page("实现基础与首版边界")
    y = d.section("工程上把不确定性说清楚", y, "01")
    y = d.para("核心计算与地图展示解耦，模拟道路和真实接口共用一套分析流程。未知路线不补成可达区域；未取全的地点结果不作为设施缺失的确定证据。", y)
    y = d.para("阈值附近局部加密、同一批测时复用多个时长、路线去重与短时缓存共同控制请求量。网页通过受限代理读取地图资源，两种AK均从服务端环境读取。", y + 12)
    y = d.section("已完成与待验证", y + 26, "02")
    y = d.table(["项目", "当前证据"], [
        ["分析核心与交互", "模拟路网、跨河绕行、近似轮廓、六类设施、覆盖核查、导出和打印"],
        ["自动化验证", "28项核心/契约/服务测试、4项浏览器流程测试通过；生产构建通过"],
        ["真实接口", "地理编码及浏览器地图均提示服务未启用，已停止；尚未形成上海实测结论"],
        ["提交准备", "私有仓库、MIT、运行说明、CI配置、两份PDF与模拟实录；正式成片待补充真实案例"],
    ], [118, CONTENT - 118], y)
    y = d.section("上海案例：四平路街道", y + 27, "03")
    y = d.para("以杨浦区四平路街道为首轮案例，候选中心为抚顺路社区睦邻中心。入口位置、设施状态与独立路线点尚待核验。后续比较直线圆、固定网格和加密网格，并记录误差与调用成本。", y)
    y = d.note("首版用于生活服务观察和现场核查准备。地图数据、采样密度与实际入口会影响结果，当前不提供自动选址优化或规划审批结论。", y + 23)
    d.para(f'源码：<link href="{REPO}" color="#0d7063">TingxuanHan/yike-yanhuo</link>（私有开发仓库）<br/>'
           "评审访问方式、公开发布和最终视频需在正式提交前落实。", y + 23, size=9.5, leading=16)
    d.save()


def architecture(d, top):
    items = [("地图工作台", "选点 / 图层 / 报告"), ("分析服务", "校验 / 任务 / 预算"), ("数据提供者", "模拟路网 / 百度接口")]
    widths = 150
    for i, (title, description) in enumerate(items):
        x = MARGIN + i * 176
        d.canvas.setFillColor(LIGHT)
        d.canvas.rect(x, H - top - 68, widths, 68, fill=1, stroke=0)
        d.text(title, x + 13, top + 12, 12, "Bold", GREEN)
        d.text(description, x + 13, top + 40, 8.5)
        if i < 2:
            d.canvas.setStrokeColor(GREEN)
            d.canvas.setLineWidth(1)
            ax = x + 154
            ay = H - top - 35
            d.canvas.line(ax, ay, ax + 16, ay)
            d.canvas.line(ax + 12, ay + 3, ax + 16, ay)
            d.canvas.line(ax + 12, ay - 3, ax + 16, ay)
    return top + 68


def technical(path: Path):
    d = Document(path, "技术与验证报告", 5)
    y = d.page("系统目标与计算模型")
    y = d.para("输入一个社区分析中心，输出5、10、15分钟近似步行可达范围、六类设施数量及待核查点位。分析以路线耗时为依据，同时保留数据不完整、未知路线和范围截断等状态。", y)
    y = d.section("架构与数据流", y + 26, "01")
    y = architecture(d, y)
    y = d.para("React 19与TypeScript提供响应式交互；Node.js负责请求校验、异步任务、预算保护和分析。核心模块独立于地图SDK，可用合成路网复现。返回结果包含轮廓、设施、完整性、质量、参数和调用统计。", y + 16)
    y = d.section("坐标与默认参数", y + 24, "02")
    y = d.table(["参数", "值与说明"], [
        ["地理坐标", "百度BD-09；地点和步行接口使用“纬度,经度”，转换接口使用“经度,纬度”"],
        ["局部坐标", "以分析中心为原点的等距圆柱近似；只用于社区尺度计算"],
        ["采样范围", "向东西南北各1600米；粗网格400米，共81个顶点"],
        ["局部加密", "阈值附近边中点最多新增96个采样点，形成局部200米间距"],
        ["时间阈值", "300 / 600 / 900秒；三个范围复用同一批测时"],
        ["设施检索", "六类关键词；每类默认1页、10条，记录返回结果是否取全"],
    ], [112, CONTENT - 112], y)
    y = d.section("任务与结果生命周期", y + 24, "03")
    d.para("分析经POST接口创建，浏览器轮询进度并可取消。正常结果在内存保留10分钟，最多保留8个任务。用户主动导出的JSON自行保存；默认不持续归档真实位置或设施结果。", y)

    y = d.page("轮廓构建与设施核查")
    y = d.section("按步行时间截取三角片", y, "01")
    y = d.para("对规则网格顶点获取步行时间，将单元拆成三角形。若三角形跨越任一时间阈值，优先对靠近中心的候选区域加密。仅当三个顶点均有有效时间时进行阈值截取。", y)
    y = d.note("边上交点：p = p_a + (T - t_a) / (t_b - t_a) × (p_b - p_a)<br/>T为目标时间；t_a、t_b为两个端点耗时；p_a、p_b为局部坐标。", y + 14)
    y = d.para("交点量化到毫米，消除相邻边反向插值引入的浮点接缝，再用polygon-clipping合并三角片。保留孔洞与分离片区，不以凸包连接未知区域。可达点触及采样边界时，报告提示范围可能被截断。", y + 15)
    y = d.para("有限采样仍可能漏掉围墙、封闭院落、河岸入口等局部障碍。局部加密存在非一致细化边界，因此轮廓是近似表达，不能据此保证多边形内任意一点均可通行。", y + 12)
    y = d.section("清洗、计数与覆盖口径", y + 24, "02")
    y = d.table(["步骤", "规则"], [
        ["分类", "菜市场、药店、小学、医疗、公园、养老；当前医疗关键词为社区卫生服务中心，养老为养老服务"],
        ["去重", "同类别优先按UID；UID缺失时按规范化名称和30米邻近规则。保留不同UID的同名分店"],
        ["圈内计数", "根据中心到设施的步行耗时判断，不以是否落入插值多边形替代路线判定"],
        ["空白候选点", "在15分钟可达采样点，检查1公里直线距离内菜市场、药店和小学"],
        ["确定性条件", "检索覆盖完整缓冲区且分类结果已取全时才标候选空白；否则标待核查"],
    ], [103, CONTENT - 103], y)
    d.para("“结果已取全”只针对接口本次召回：必须有总数、未达到150条总量上限、已取足且无非法条目。它不证明地图已收录全部设施，也不证明设施正在营业。", y + 19, size=10, leading=16)

    y = d.page("接口、密钥与调用预算")
    y = d.table(["服务", "用途", "调用策略"], [
        ["地点检索3.0", "六类周边设施", "默认最多6次/分析；每类1页，10条"],
        ["步行批量算路2.0", "网格及设施测时", "按路线条数限流；默认3条/秒"],
        ["地理编码3.0", "地址转百度坐标", "显式点击定位；发出请求前校验128字节上限"],
        ["坐标转换2.0", "外部坐标统一", "按需转换；明确输入坐标类型"],
        ["JSAPI 4.0", "地图底图和覆盖物", "服务端受限代理；默认界面不加载真实地图"],
    ], [117, 108, CONTENT - 225], y)
    y = d.section("预算先行，失败也记账", y + 25, "01")
    y = d.para("应用默认每分析最多300条路线；每日保护值为1200条路线、80次地点检索。手动实测更保守：单分析260条、每日500条路线与12次地点检索。配额上限应结合账号当前余额设置。", y)
    y = d.para("请求发出前持久化北京时间日计数，重启不清零。仅对网络异常和HTTP 429/5xx等暂态错误最多重试一次，重试也计量；权限与业务配额错误立即停止。12秒超时、两分钟缓存及同批坐标复用限制等待与重复调用。", y + 12)
    y = d.section("密钥不进入网页和材料", y + 24, "02")
    y = d.para("浏览器AK与服务端AK仅保存在本地.env或运行环境，.env被Git忽略。配置接口仅返回就绪布尔值；地图代理固定百度上游域名、限制资源路径，并拒绝回显密钥的响应。SDK加载前先做权限预检，失败缓存两分钟。错误提示不透传鉴权响应。", y)
    y = d.note("本地预算只覆盖当前数据目录的单个进程，不能看见账号其他应用或其他机器的用量。不得同时运行多个真实调用进程；百度控制台的余额与计费规则仍是最终依据。", y + 18)
    d.para("当前用于单机开发和受控演示。对外部署需补充访问认证、HTTPS与整体限流；地图数据及依赖遵循各自授权，MIT只覆盖项目自有代码。", y + 18, size=10, leading=16)

    y = d.page("验证记录与证据边界")
    y = d.para("验证环境：Windows、Node.js 24.18.0、Microsoft Edge。自动化用例使用模拟路网或受控接口响应，不消耗真实百度配额。记录日期：2026-10-05。", y)
    y = d.table(["验证项", "结果", "主要覆盖"], [
        ["生产构建", "通过", "TypeScript检查、Vite客户端与服务端编译"],
        ["核心/契约/HTTP", "28项通过", "跨河绕行、未知状态、坐标、清洗、配额恢复、取消、地址边界、权限预检与密钥回显拒绝"],
        ["浏览器流程", "4项通过", "1360px桌面、390px手机、换起点、筛选复用、导出、打印及地图权限失败恢复"],
        ["视觉检查", "完成", "桌面和手机演示结果截图；无水平溢出"],
        ["Docker", "未运行", "仅提供构建配置，不能据此认定镜像验证完成"],
    ], [103, 73, CONTENT - 176], y + 18)
    y = d.section("一个已复现并修正的问题", y + 25, "01")
    y = d.para("河畔中心曾触发多边形合并失败。追踪到共享边反向插值产生的浮点接缝后，对交点实施毫米量化，并加入河畔、桥两侧及采样边缘中心的回归检查。修正后相关核心与手机流程测试通过。", y)
    y = d.note("合成默认起点：153/153个有效采样点；15分钟近似面积约2.27平方公里，已发现9处设施。道路和设施为人工构造，这些数值不是上海社区结论。", y + 17)
    y = d.section("真实接口预检", y + 24, "02")
    y = d.para("本地已配置两个独立AK。首条地理编码请求返回240，即对应服务未启用；流程随即停止。该轮发送地理编码1次，地点检索0次、步行路线0条。未在版本库保存密钥或原始鉴权响应。", y)
    d.para("浏览器SDK引导资源加载成功，但认证同样提示服务被禁用，未显示底图。累计地图代理转发10次，本轮检查未发现浏览器请求或页面文本含AK。已修正代理路径并补充权限失败恢复；完整底图、上海分析及独立对照仍待验证。", y + 12, size=10, leading=16)

    y = d.page("上海验证方案与复现")
    y = d.para("首轮候选为杨浦区四平路街道抚顺路社区睦邻中心。地名资料只能辅助选择案例，不能代替入口和路线核验。本报告尚不填入未经验证的社区坐标、设施数量或精度结论。", y)
    y = d.table(["下一步", "执行与记录"], [
        ["确定入口", "定位后人工核对入口，保存BD-09坐标、核查日期和选点理由"],
        ["独立验证", "至少20个不参与轮廓构建的点；覆盖临界时长、桥、围墙和不同方向"],
        ["方法对照", "直线圆、固定网格、局部加密；统一输入点、时间阈值和API口径"],
        ["质量与成本", "阈值判断一致率、误差分布、有效路线比例、调用条数和耗时；分别记录API对照与现场核验"],
        ["设施复核", "抽查分类、营业状态和入口；核查候选空白点周边真实设施"],
    ], [100, CONTENT - 100], y + 16)
    y = d.section("本地复现", y + 23, "01")
    y = d.para("推荐Node.js 24。依次执行npm ci、npm run build、npm test、npm run test:ui；npm start启动后访问http://127.0.0.1:8787。模拟模式无需密钥。真实接口仅在主动运行实测脚本或点击相应操作时调用。", y)
    y = d.para("源码含部署说明、验证记录、演示脚本及带字幕的模拟实录。未实现人口加权覆盖、无障碍专用路线、施工感知、自动选址、多租户鉴权和跨进程配额。正式视频的真实案例片段与评审访问安排待完成。", y + 11)
    y = d.section("主要依据", y + 23, "02")
    refs = [
        ("大赛官网与赛题", "https://www.oschina.net/os2026/"),
        ("百度地点检索3.0", "https://lbsyun.baidu.com/docs/webapi?title=placev3/guide/webservice-placeapiV3/interfaceDocumentV3"),
        ("百度步行批量算路", "https://lbsyun.baidu.com/docs/webapi?title=routematrix/routchtout-walk"),
        ("地理编码与错误状态", "https://lbs.baidu.com/docs/webapi?title=geocoding/guide/webservice-geocoding-base"),
        ("坐标转换2.0", "https://lbsyun.baidu.com/docs/webapi?title=geoconv/guide/changeposition-base"),
        ("JSAPI代理机制", "https://lbs.baidu.com/docs/jsapi?title=jsapi4/guide/concepts/proxy"),
    ]
    for idx in range(0, len(refs), 2):
        for j, (label, url) in enumerate(refs[idx:idx + 2]):
            d.para(f'{idx + j + 1}. <link href="{escape(url)}" color="#0d7063">{label}</link>', y,
                   x=MARGIN + j * 260, width=240, size=9, leading=15)
        y += 23
    d.para(f'<link href="{REPO}" color="#0d7063">项目源码：TingxuanHan/yike-yanhuo</link>　·　依据核查日期：2026-10-05',
           y + 4, size=8.5, leading=14, color=MUTED)
    d.save()


def main():
    fonts = Path(os.environ.get("WINDIR", "C:/Windows")) / "Fonts"
    parser = argparse.ArgumentParser()
    parser.add_argument("--font-regular", type=Path, default=fonts / "msyh.ttc")
    parser.add_argument("--font-bold", type=Path, default=fonts / "msyhbd.ttc")
    parser.add_argument("--output-dir", type=Path, default=ROOT / "materials")
    args = parser.parse_args()
    pdfmetrics.registerFont(TTFont("Body", str(args.font_regular)))
    pdfmetrics.registerFont(TTFont("Bold", str(args.font_bold)))
    pdfmetrics.registerFontFamily("Body", normal="Body", bold="Bold", italic="Body", boldItalic="Bold")
    args.output_dir.mkdir(parents=True, exist_ok=True)
    introduction(args.output_dir / "yike-yanhuo-introduction.pdf")
    technical(args.output_dir / "yike-yanhuo-technical-report.pdf")
    print("Created introduction (3 pages) and technical report (5 pages).")


if __name__ == "__main__":
    main()
