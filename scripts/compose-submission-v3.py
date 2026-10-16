"""Edit live API waiting time, then add neural narration and burned-in subtitles."""
from pathlib import Path
import importlib.util, json, math, subprocess, wave
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('media',ROOT/'scripts/compose-submission.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

def main():
    raw=json.loads((ROOT/'materials/submission-v3-timeline.json').read_text(encoding='utf-8'))
    voice={v['id']:v for v in json.loads((ROOT/'.cache/submission-v3-voice/manifest.json').read_text(encoding='utf-8'))}
    assert raw['browserErrors']==0 and len(raw['scenes'])==12
    extra=ROOT/'.cache/submission-v3-planning.json'
    replacement=json.loads(extra.read_text()) if extra.exists() else None
    sources=[raw['video']]
    original_index=None
    if raw.get('initialLiveRecording'):
        original_index=len(sources);sources.append(raw['initialLiveRecording']['video'])
    replacement_index=None
    if replacement:
        replacement_index=len(sources);sources.append(replacement['video'])
    edits=[];scenes=[];cursor=0.0
    for scene in raw['scenes']:
        s,e=scene['start']/1000,scene['end']/1000
        target=max(voice[scene['id']]['duration'],e-s)
        regions=[(0,s,e)]
        if scene['id']=='analyze' and e-s>voice['analyze']['duration']+3:
            target=voice['analyze']['duration']+1
            regions=[(0,s,s+7),(0,e-(target-7),e)]
        if scene['id']=='analyze' and original_index is not None:
            target=voice['analyze']['duration']+1
            first=raw['initialLiveRecording']['analysis']['start']/1000
            regions=[(original_index,first,first+3),(original_index,first+80,first+84),(0,e-(target-7),e)]
        if scene['id']=='planning' and replacement:
            target=voice['planning']['duration']+1
            a,z=replacement['start']/1000,replacement['end']/1000
            assert z-a>=target
            regions=[(replacement_index,a,a+7),(replacement_index,z-(target-7),z)]
        assert abs(sum(e-s for _,s,e in regions)-target)<.01
        for index,a,z in regions:edits.append({'source':index,'start':a,'end':z,'scene':scene['id']})
        scenes.append({**scene,'start':round(cursor*1000),'end':round((cursor+target)*1000)})
        cursor+=target
    duration=cursor;rate=22050
    audio=bytearray(math.ceil(duration*rate)*2)
    subtitles=[];coverage=[]
    ass=['[Script Info]','ScriptType: v4.00+','PlayResX: 1600','PlayResY: 900','WrapStyle: 2','','[V4+ Styles]',
      'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
      'Style: Spoken,Microsoft YaHei,28,&H00FFFFFF,&H00FFFFFF,&H00383E12,&H00383E12,0,0,0,0,100,100,0,0,1,0,0,8,60,60,10,1',
      'Style: Chapter,Microsoft YaHei,18,&H00C8E3DA,&H00FFFFFF,&H00383E12,&H00383E12,0,0,0,0,100,100,0,0,1,0,0,8,60,60,10,1','',
      '[Events]','Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text']
    transcript=['# 一刻烟火：真实API演示旁白','','配音：普通话预设神经网络音色；所有角色为系统预设，无真人声音克隆。上海片段在录制时调用真实百度API，中间等待剪短；其后构造演练与微信静帧分别标注。','',
      '项目：一刻烟火；赛道：开源 AI 工具赛道；企业赛题：【开源 AI 工具赛道】百度地图赛题：基于地图开放能力的“15 分钟生活圈”智能体检与规划助手。负责人：韩庭轩；单位/学校：南京大学；其他团队成员：姜可。','']
    for scene in scenes:
        s,e=scene['start']/1000,scene['end']/1000;t=s+.4
        ass.append(f'Dialogue: 0,{m.stamp(s,True)},{m.stamp(e,True)},Chapter,,0,0,0,,{{\\an8\\pos(800,805)}}'+scene['title'])
        transcript.extend([f'## {m.stamp(s).split(",")[0]} {scene["title"]}',''])
        for seg in voice[scene['id']]['segments']:
            with wave.open(str(ROOT/seg['file'])) as f:
                assert (f.getframerate(),f.getnchannels(),f.getsampwidth())==(rate,1,2)
                frames=f.readframes(f.getnframes())
            length=len(frames)/(2*rate);assert t+length<e
            offset=round(t*rate)*2;audio[offset:offset+len(frames)]=frames
            text=m.wrap_line(seg['text']);assert len(text.splitlines())<=2
            subtitles.append(f'{len(subtitles)+1}\n{m.stamp(t)} --> {m.stamp(t+length)}\n{text}\n')
            caption=text.replace('\n','\\N')
            ass.append(f'Dialogue: 1,{m.stamp(t,True)},{m.stamp(t+length,True)},Spoken,,0,0,0,,{{\\an8\\pos(800,836)}}'+caption)
            coverage.append({'scene':scene['id'],'start':round(t,3),'end':round(t+length,3),'text':seg['text']})
            transcript.extend([seg['text'],'']);t+=length+.2
    with wave.open(str(ROOT/'.cache/submission-v3-narration.wav'),'wb') as f:
        f.setnchannels(1);f.setsampwidth(2);f.setframerate(rate);f.writeframes(audio)
    (ROOT/'.cache/submission-v3.ass').write_text('\n'.join(ass)+'\n',encoding='utf-8-sig')
    (ROOT/'materials/yike-yanhuo-baidu-v3.srt').write_text('\n'.join(subtitles),encoding='utf-8')
    (ROOT/'materials/submission-v3-caption-timing.json').write_text(json.dumps(coverage,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    (ROOT/'docs/submission-v3-transcript.md').write_text('\n'.join(transcript),encoding='utf-8')
    final={**raw,'rawVideo':raw['video'],'video':'materials/yike-yanhuo-baidu-v3.mp4','scenes':scenes,'edits':edits,'narrator':'zh-CN-XiaoxiaoNeural','waitingTrimmed':True}
    (ROOT/'materials/submission-v3-edited-timeline.json').write_text(json.dumps(final,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    # The verifier consumes the edited time base, while the raw manifest remains available.
    (ROOT/'.cache/submission-v3-raw-timeline.json').write_text(json.dumps(raw,ensure_ascii=False,indent=2),encoding='utf-8')
    filters=[]
    for i,edit in enumerate(edits):
        filters.append(f'[{edit["source"]}:v]trim=start={edit["start"]:.6f}:end={edit["end"]:.6f},setpts=PTS-STARTPTS[v{i}]')
    filters.append(''.join(f'[v{i}]' for i in range(len(edits)))+f'concat=n={len(edits)}:v=1:a=0,pad=1600:900:0:0:color=0x123e38,ass=.cache/submission-v3.ass[outv]')
    cmd=['ffmpeg','-hide_banner','-loglevel','warning','-y']
    for source in sources:cmd+=['-i',source]
    cmd+=['-i','.cache/submission-v3-narration.wav','-filter_complex',';'.join(filters),'-map','[outv]','-map',f'{len(sources)}:a','-af','loudnorm=I=-16:TP=-1.5:LRA=7','-c:v','libx264','-preset','medium','-crf','20','-pix_fmt','yuv420p','-r','25','-c:a','aac','-b:a','128k','-ar','48000','-ac','2','-t',str(duration),'-movflags','+faststart','-metadata','title=一刻烟火：上海社区真实API演示','-metadata','artist=韩庭轩、姜可｜南京大学','materials/yike-yanhuo-baidu-v3.mp4']
    subprocess.run(cmd,cwd=ROOT,check=True)
    subprocess.run(['ffmpeg','-v','error','-y','-ss','4','-i','materials/yike-yanhuo-baidu-v3.mp4','-frames:v','1','materials/yike-yanhuo-baidu-v3-cover.png'],cwd=ROOT,check=True)
    removed=(raw['initialLiveRecording']['analysis']['end']-raw['initialLiveRecording']['analysis']['start'])/1000-(voice['analyze']['duration']+1) if original_index is not None else max(0,raw['scenes'][-1]['end']/1000-duration)
    print(json.dumps({'seconds':duration,'scenes':len(scenes),'captions':len(coverage),'waitingRemovedSeconds':round(removed,3)}))

if __name__=='__main__':main()
