"""Render a two-page supplement without replacing the fixed submission-v1 assets."""
from pathlib import Path
import importlib.util
import json
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("submission_layout", ROOT / "scripts/build-submission.py")
layout = importlib.util.module_from_spec(spec)
spec.loader.exec_module(layout)
for name, path in [("Body", "C:/Windows/Fonts/msyh.ttc"), ("BodyBold", "C:/Windows/Fonts/msyhbd.ttc")]:
    pdfmetrics.registerFont(TTFont(name, path, subfontIndex=0))
pdfmetrics.registerFontFamily("Body", normal="Body", bold="BodyBold", italic="Body", boldItalic="BodyBold")
out = ROOT / "materials/yike-yanhuo-calibration-addendum.pdf"
d = layout.Book(out, total_pages=2, md_output="docs/submission-calibration-addendum.md")
d.md = ["# 实走校准与前瞻验证：参赛补充说明", "", "功能基线541d9cf；2026-10-16。与固定提交版v1共同阅读；不改写原视频或既有API实验。", ""]
d.c.setTitle("一刻烟火｜实走校准与前瞻验证补充说明")
d.page("让个人步速有实走依据", "技术创新30% · 场景落地30%｜新增能力")
d.p("普通步速设置依赖用户猜测。本次补充建立“准备记录、补记实际、比较误差、确认采用”的完整流程：Web和微信共用一套计算与私人同步数据，给个性化15分钟生活圈提供可追溯的步速输入。")
d.table(["先后顺序", "实现与约束"], [
    ["出发前固定预测", "保存距离、来源、当时步速及已有记录生成的建议；建议记录引用严格早于本次准备的历史。"],
    ["走完后填实际", "纯步行秒数 = 总用时 - 等灯/休息/办事秒数；只纳入同一出门者、已量距离、相近日常走法。"],
    ["用户决定应用", "至少3次且合计300米，使用中位数；差异过大暂不给建议。采用后只改日常步速，旧行程须重新试算。"],
], [1.15, 3.6], size=9.3)
top = d.y
d.img("docs/images/walk-calibration-mini.png", width=120, top=top)
d.p("<b>实际原生页面 · 构造布局数据</b><br/>截图中的记录为测试构造，非居民现场记录。展示当前步速、建议步速、样本数量和用时范围；详细依据默认折叠。", x=layout.M+138, width=layout.CW-138, top=top+4, size=10, leading=17)
d.p("<b>可解释的保护</b><br/>地图估算、模拟练习、异常步速、超过90天及主动排除的记录不进入日常建议。记录间最大/最小步速比超过1.5时提示重新测量。这里的门槛是产品保护规则，尚未人群验证。", x=layout.M+138, width=layout.CW-138, top=top+110, size=10, leading=17)
d.y = top + 280
d.note("应用价值：复用已有百度路线距离重新试算个人可达范围，不新增地图请求；既不把范围当作到达保证，也不把步速换算当作健康评估。只支持一本私人地点簿中的同一位出门者，家人可代填。")
d.page("保留改善，也保留失效情形", "技术验证 · 开源治理20% · 长期发展20%")
d.p("固定构造对照先提供3次历史，再逐次准备和观察后续记录。基线为当时设置的1.2米/秒，建议为准备时可用历史的中位数。两者在同一批后续记录上比较纯步行秒数的平均绝对误差。")
data = json.loads((ROOT / "docs/experiments/walk-calibration-simulation.json").read_text(encoding="utf8"))
rows=[]
for r in data["results"]:
    s=r["summary"]
    rows.append([r["label"], s["evaluationCount"], "-" if s["baselineMaeSeconds"] is None else s["baselineMaeSeconds"], "-" if s["calibratedMaeSeconds"] is None else s["calibratedMaeSeconds"]])
d.table(["构造场景", "后续数", "当时设置误差/秒", "事先建议误差/秒"], rows, [2.4,0.7,1.25,1.25], size=9, leading=14)
d.note("全部为仿真数据，不是现场精度结论。走法改变场景中，历史建议比原设置更差；不能宣称校准必然有效。样本步速范围不是概率或置信区间。")
d.h("工程与治理证据")
d.table(["评分关注", "本轮交付"], [
    ["可运行、可测试", "193项业务/HTTP/原生页面测试、36项浏览器流程通过；构建和改动格式通过。微信CLI原生页面与大字显示已检查。"],
    ["完整且可复核", "有版本的记录格式与固定构造数据、可重复的benchmark命令；导出保留原预测、来源、排除原因和历史引用。"],
    ["持续维护", "30条容量明确提示；备份后显式清空，保留偏好和地点。冲突补记不覆盖、失败保留输入；沿用MIT与既有贡献机制。"],
], [1.25,4.25], size=9.2)
d.p("<b>下一步现场采集：</b>同一位使用者在已量长度的平路记录至少3次，随后提前准备3次新记录再实走；保留全部后续结果与排除理由。新增页面的实体手机及真实步行验证尚未完成。", size=9.5, leading=15)
url="https://github.com/TingxuanHan/yike-yanhuo/tree/541d9cf"
d.p(f"代码基线：<link href='{url}' color='#176c60'>541d9cf</link>；复现：npm run benchmark:walk。<br/>详见docs/walk-calibration.md及docs/experiments/walk-calibration-simulation.json。仓库仍私有；本补充不更改v1发布附件。", size=8.8, leading=14)
d.save()
print(json.dumps({"pdf":str(out),"pages":2},ensure_ascii=False))
