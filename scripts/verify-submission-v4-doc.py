from pathlib import Path
from pypdf import PdfReader
import hashlib,json
root=Path(__file__).resolve().parents[1];file=root/'materials/yike-yanhuo-baidu-v4.pdf'
r=PdfReader(file);assert len(r.pages)==14
texts=[p.extract_text() for p in r.pages];text='\n'.join(texts)
anchors=['韩庭轩','南京大学','姜可','开源 AI 工具赛道','百度地图赛题','技术架构','背景','创新','共享','连续覆盖','核查台账','定向','补点','抽点','绕行','校准','价格','运动','私人地点','语音','自用API','简易','远程','位置','邻里','配对','备份','MIT','40%','30%','15%']
for a in anchors:assert a in text,a
for i,t in enumerate(texts):assert f'{i+1:02d} / 14' in t
assert len(text)>5000
for page in r.pages:
 for value in page['/Resources']['/Font'].values():
  desc=value.get_object().get('/FontDescriptor')
  if desc:assert any(k in desc.get_object() for k in ['/FontFile','/FontFile2','/FontFile3'])
result={'passed':True,'pages':14,'requiredRegistration':True,'functionalAnchors':anchors,'characters':len(text),'embeddedChineseFonts':True,'bytes':file.stat().st_size,'sha256':hashlib.sha256(file.read_bytes()).hexdigest()}
(root/'docs/validation/submission-v4-doc.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf-8');print(json.dumps(result,ensure_ascii=False))
