"""Generate sentence-aligned neural Mandarin narration in an isolated dependency folder."""
from pathlib import Path
import asyncio, json, subprocess, sys, wave
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / '.cache/tts-deps'))
import edge_tts

async def main():
    story=json.loads((ROOT/'docs/submission-video-v3.json').read_text(encoding='utf-8'))
    folder=ROOT/'.cache/submission-v3-voice';folder.mkdir(exist_ok=True,parents=True)
    manifest=[]
    for scene in story['scenes']:
        segments=[]
        for n,text in enumerate(scene['lines']):
            stem=folder/(scene['id']+'-'+str(n+1))
            mp3=stem.with_suffix('.mp3');wav=stem.with_suffix('.wav')
            if not mp3.exists():
                await edge_tts.Communicate(text,'zh-CN-XiaoxiaoNeural',rate='-3%').save(str(mp3))
            subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-y','-i',str(mp3),'-ar','22050','-ac','1','-c:a','pcm_s16le',str(wav)],check=True)
            with wave.open(str(wav)) as a: duration=a.getnframes()/a.getframerate()
            segments.append({'text':text,'file':wav.relative_to(ROOT).as_posix(),'duration':duration})
        manifest.append({'id':scene['id'],'title':scene['title'],'segments':segments,'duration':sum(s['duration'] for s in segments)+1.6})
        print(scene['id'],round(manifest[-1]['duration'],2),flush=True)
    (folder/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(json.dumps({'voice':'zh-CN-XiaoxiaoNeural','seconds':sum(s['duration'] for s in manifest),'scenes':len(manifest)}))

if __name__=='__main__':asyncio.run(main())
