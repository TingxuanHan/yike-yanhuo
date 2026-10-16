"""Publishable, credential-checked source and concise competition material bundle."""
from pathlib import Path,PurePosixPath
from datetime import datetime,timezone
import importlib.util,json,subprocess,zipfile
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('previous',ROOT/'scripts/package-submission-v2.py')
p=importlib.util.module_from_spec(spec);spec.loader.exec_module(p)
TAG='os2026-baidu-v4-20261016'

def main():
    revision=p.git('rev-parse','HEAD')
    status=subprocess.check_output(p.GIT+['status','--porcelain','--untracked-files=no'],cwd=ROOT).decode('utf-8')
    assert all(line[3:]=='miniprogram/project.config.json' for line in status.splitlines() if line),'Commit material changes before exporting'
    source=ROOT/'materials/yike-yanhuo-source-v4.zip'
    subprocess.run(p.GIT+['archive','--format=zip','--prefix=yike-yanhuo/','-o',str(source),revision],cwd=ROOT,check=True)
    secrets=p.local_secrets()
    with zipfile.ZipFile(source) as z:
        assert z.testzip() is None
        forbidden={'.env','.data','.cache','node_modules','.git','project.private.config.json'}
        for entry in z.infolist():
            assert not forbidden.intersection(PurePosixPath(entry.filename).parts)
            if not entry.is_dir():assert not any(s in z.read(entry) for s in secrets),'Credential found in source'
        for name in ['package.json','package-lock.json','.env.example','src/server/app.ts','miniprogram/app.json','LICENSE','README.md','docs/submission-v4-brief.md']:
            assert 'yike-yanhuo/'+name in z.namelist()
        entries=len(z.infolist())
    files=['yike-yanhuo-baidu-v4.pdf','yike-yanhuo-baidu-v4.mp4','yike-yanhuo-baidu-v4.srt','yike-yanhuo-baidu-v4-cover.png','yike-yanhuo-source-v4.zip']
    for name in files:assert not any(s in (ROOT/'materials'/name).read_bytes() for s in secrets)
    manifest={'createdAt':datetime.now(timezone.utc).isoformat(),'tag':TAG,'commit':revision,'functionalBaseline':'e28efa0','repositoryAccess':'public','release':'https://github.com/TingxuanHan/yike-yanhuo/releases/tag/'+TAG,'registration':json.loads((ROOT/'docs/submission-video-v4.json').read_text(encoding='utf-8'))['registration'],'sourceAudit':{'entries':entries,'configuredCredentialsChecked':len(secrets),'secretMatches':0},'assets':[{'name':name,'bytes':(ROOT/'materials'/name).stat().st_size,'sha256':p.digest(ROOT/'materials'/name)} for name in files]}
    proof=ROOT/'.cache/submission-v4-source-check.json'
    if proof.exists():
        value=json.loads(proof.read_text(encoding='utf-8'))
        if value.get('sourceCommit')==revision:
            assert value['passed'] and value['sourceSha256']==p.digest(source)
            manifest['sourceBuildCheck']=value
    manifestName='submission-v4-manifest.json';sumsName='SHA256SUMS-v4.txt'
    (ROOT/'materials'/manifestName).write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    files.append(manifestName)
    (ROOT/'materials'/sumsName).write_text('\n'.join(f'{p.digest(ROOT/"materials"/name)}  {name}' for name in files)+'\n',encoding='utf-8')
    files.append(sumsName)
    bundle=ROOT/'materials/yike-yanhuo-baidu-v4.zip'
    with zipfile.ZipFile(bundle,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=6) as z:
        for name in files:z.write(ROOT/'materials'/name,name)
        for file,label in [('docs/submission-v4-guide.md','材料与运行索引.md'),('docs/submission-v4-brief.md','作品介绍可编辑稿.md'),('docs/submission-v4-transcript.md','视频旁白与章节.md'),('docs/submission-v4-validation.md','材料验收.md'),('docs/validation/submission-v4-doc.json','文档检查.json'),('docs/validation/submission-v4-video.json','视频检查.json')]:z.write(ROOT/file,label)
        for name in ['shanghai-analysis.json','live-summary.json']:z.write(ROOT/'materials/submission-v3-evidence'/name,'本轮真实API/'+name)
        if 'sourceBuildCheck' in manifest:z.write(proof,'源码解压构建检查.json')
    with (ROOT/'materials'/sumsName).open('a',encoding='utf-8') as f:f.write(f'{p.digest(bundle)}  {bundle.name}\n')
    print(json.dumps({'commit':revision,'sourceEntries':entries,'sourceBytes':source.stat().st_size,'bundleBytes':bundle.stat().st_size,'secretMatches':0}))

if __name__=='__main__':main()

