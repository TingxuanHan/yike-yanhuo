"""Assemble the full feature walkthrough from real UI recordings with aligned narration."""
from pathlib import Path
import importlib.util,json,math,subprocess,wave
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('media',ROOT/'scripts/compose-submission.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
def run(args):subprocess.run(args,cwd=ROOT,check=True,stdout=subprocess.DEVNULL)
def main():
    story=json.loads((ROOT/'docs/submission-video-v4.json').read_text(encoding='utf-8'))
    voices={x['id']:x for x in json.loads((ROOT/'.cache/submission-v4-voice/manifest.json').read_text(encoding='utf-8'))}
    versions={'v3':json.loads((ROOT/'materials/submission-v3-edited-timeline.json').read_text(encoding='utf-8')),'v2':json.loads((ROOT/'materials/submission-v2-timeline.json').read_text(encoding='utf-8')),'new':json.loads((ROOT/'materials/submission-v4-extra-timeline.json').read_text(encoding='utf-8'))}
    assert versions['new']['browserErrors']==[] and versions['new']['prohibitedRequests']==0
    sources={'v3':'materials/yike-yanhuo-baidu-v3.mp4','v2':'.cache/submission-v2-raw.webm','new':'.cache/submission-v4-extra.webm'}
    folder=ROOT/'.cache/submission-v4-segments';folder.mkdir(exist_ok=True)
    scenes=[];cursor=0.0;edits=[]
    for n,s in enumerate(story['scenes']):
        version=s['source']['version'];old=next(x for x in versions[version]['scenes'] if x['id']==s['source']['id'])
        a,z=old['start']/1000,old['end']/1000;target=voices[s['id']]['duration']+.3
        file=folder/f'{n:02d}.mp4';cmd=['ffmpeg','-v','error','-y']
        if z-a>target+.5:
            first=min(4,target/3);last=target-first
            cmd+=['-ss',str(a),'-t',str(first),'-i',sources[version],'-ss',str(z-last),'-t',str(last),'-i',sources[version],'-filter_complex','[0:v]crop=1600:800:0:0,fps=25,setpts=PTS-STARTPTS[a];[1:v]crop=1600:800:0:0,fps=25,setpts=PTS-STARTPTS[b];[a][b]concat=n=2:v=1:a=0[out]','-map','[out]']
        else:
            cmd+=['-ss',str(a),'-t',str(z-a),'-i',sources[version],'-vf',f'crop=1600:800:0:0,fps=25,setpts=PTS-STARTPTS,tpad=stop_mode=clone:stop_duration={max(0,target-(z-a))+.1},trim=duration={target}']
        # Whole-frame duration keeps the concatenated audio/subtitle timeline exact.
        frames=math.ceil(target*25);target=frames/25
        cmd+=['-an','-c:v','libx264','-preset','veryfast','-crf','18','-pix_fmt','yuv420p','-frames:v',str(frames),str(file)]
        run(cmd)
        target=float(json.loads(subprocess.check_output(['ffprobe','-v','error','-show_entries','format=duration','-of','json',str(file)],cwd=ROOT))['format']['duration'])
        assert target>=voices[s['id']]['duration']
        scenes.append({'id':s['id'],'title':s['title'],'start':round(cursor*1000),'end':round((cursor+target)*1000)})
        edits.append({'id':s['id'],'sourceVersion':version,'sourceScene':s['source']['id'],'sourceStart':a,'sourceEnd':z,'seconds':target})
        cursor+=target;print(f'Assembled {n+1}/{len(story["scenes"])}: {s["id"]}',flush=True)
    concat=folder/'concat.txt';concat.write_text('\n'.join(f"file '{(folder/f'{i:02d}.mp4').as_posix()}'" for i in range(len(scenes))),encoding='utf-8')
    run(['ffmpeg','-v','error','-y','-f','concat','-safe','0','-i',str(concat),'-c','copy','.cache/submission-v4-edited.mp4'])
    rate=22050;audio=bytearray(math.ceil(cursor*rate)*2);captions=[];srt=[]
    ass=['[Script Info]','ScriptType: v4.00+','PlayResX: 1600','PlayResY: 900','WrapStyle: 2','','[V4+ Styles]','Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding','Style: Spoken,Microsoft YaHei,28,&H00FFFFFF,&H00FFFFFF,&H00383E12,&H00383E12,0,0,0,0,100,100,0,0,1,0,0,8,60,60,10,1','Style: Chapter,Microsoft YaHei,18,&H00C8E3DA,&H00FFFFFF,&H00383E12,&H00383E12,0,0,0,0,100,100,0,0,1,0,0,8,60,60,10,1','','[Events]','Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text']
    transcript=['# 一刻烟火：完整功能演示旁白','','预设普通话神经网络配音。包含本轮真实上海API、构造场景实际操作与明确标注的历史接口/微信页面留档。','',json.dumps(story['registration'],ensure_ascii=False),'']
    for scene in scenes:
        a,z=scene['start']/1000,scene['end']/1000;t=a+.4
        ass.append(f'Dialogue: 0,{m.stamp(a,True)},{m.stamp(z,True)},Chapter,,0,0,0,,{{\\an8\\pos(800,805)}}'+scene['title']);transcript.extend([f'## {m.stamp(a).split(",")[0]} {scene["title"]}',''])
        for seg in voices[scene['id']]['segments']:
            with wave.open(str(ROOT/seg['file'])) as f:assert(f.getframerate(),f.getnchannels(),f.getsampwidth())==(rate,1,2);data=f.readframes(f.getnframes())
            duration=len(data)/(rate*2);assert t+duration<z
            offset=round(t*rate)*2;audio[offset:offset+len(data)]=data
            text=m.wrap_line(seg['text']);assert len(text.splitlines())<=2
            srt.append(f'{len(srt)+1}\n{m.stamp(t)} --> {m.stamp(t+duration)}\n{text}\n');escaped=text.replace('\n','\\N')
            ass.append(f'Dialogue: 1,{m.stamp(t,True)},{m.stamp(t+duration,True)},Spoken,,0,0,0,,{{\\an8\\pos(800,836)}}'+escaped)
            captions.append({'scene':scene['id'],'start':round(t,3),'end':round(t+duration,3),'text':seg['text']});transcript.extend([seg['text'],'']);t+=duration+.2
    with wave.open(str(ROOT/'.cache/submission-v4-narration.wav'),'wb') as f:f.setnchannels(1);f.setsampwidth(2);f.setframerate(rate);f.writeframes(audio)
    (ROOT/'.cache/submission-v4.ass').write_text('\n'.join(ass)+'\n',encoding='utf-8-sig')
    (ROOT/'materials/yike-yanhuo-baidu-v4.srt').write_text('\n'.join(srt),encoding='utf-8')
    (ROOT/'materials/submission-v4-caption-timing.json').write_text(json.dumps(captions,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    (ROOT/'materials/submission-v4-edited-timeline.json').write_text(json.dumps({'video':'materials/yike-yanhuo-baidu-v4.mp4','scenes':scenes,'edits':edits,'browserErrors':0,'blockedRequests':0},ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    (ROOT/'docs/submission-v4-transcript.md').write_text('\n'.join(transcript),encoding='utf-8')
    run(['ffmpeg','-hide_banner','-loglevel','warning','-y','-i','.cache/submission-v4-edited.mp4','-i','.cache/submission-v4-narration.wav','-vf','pad=1600:900:0:0:color=0x123e38,ass=.cache/submission-v4.ass','-af','loudnorm=I=-16:TP=-1.5:LRA=7','-map','0:v:0','-map','1:a:0','-c:v','libx264','-preset','medium','-crf','20','-pix_fmt','yuv420p','-r','25','-c:a','aac','-b:a','128k','-ar','48000','-ac','2','-t',str(cursor),'-movflags','+faststart','-metadata','title=一刻烟火：完整功能与创新演示','-metadata','artist=韩庭轩、姜可｜南京大学','materials/yike-yanhuo-baidu-v4.mp4'])
    run(['ffmpeg','-v','error','-y','-ss','4','-i','materials/yike-yanhuo-baidu-v4.mp4','-frames:v','1','materials/yike-yanhuo-baidu-v4-cover.png'])
    print(json.dumps({'seconds':cursor,'scenes':len(scenes),'captions':len(captions)}))
if __name__=='__main__':main()
