from pathlib import Path
import hashlib,json
from pypdf import PdfReader
ROOT=Path(__file__).resolve().parents[1]
path=ROOT/'materials/yike-yanhuo-baidu-v3.pdf'
r=PdfReader(path);assert len(r.pages)==6
texts=[p.extract_text() for p in r.pages];text='\n'.join(texts)
anchors=['韩庭轩','南京大学','姜可','开源 AI 工具赛道','百度地图赛题','项目背景','技术架构','应用场景','核心创新','236','1101','40%','30%','15%']
for a in anchors:assert a in text,a
for i,t in enumerate(texts):assert f'{i+1:02d} / 06' in t
fonts=[]
for page in r.pages:
    for value in page['/Resources']['/Font'].values():
        f=value.get_object();desc=f.get('/FontDescriptor')
        if desc:assert any(k in desc.get_object() for k in ['/FontFile','/FontFile2','/FontFile3'])
        fonts.append(str(f.get('/BaseFont')))
assert not any(x in text for x in ['18页','提交说明','未来展望','仓库仍为私有'])
result={'passed':True,'pages':6,'requiredRegistration':True,'requiredTopics':True,'embeddedChineseFonts':True,'fonts':sorted(set(fonts)),'bytes':path.stat().st_size,'sha256':hashlib.sha256(path.read_bytes()).hexdigest()}
(ROOT/'docs/validation/submission-v3-doc.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps(result,ensure_ascii=False))
