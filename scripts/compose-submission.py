"""Compose the actual UI recording with locally rendered narration and captions."""
from pathlib import Path
import json
import math
import subprocess
import wave

ROOT = Path(__file__).resolve().parents[1]


def run(args):
    subprocess.run(args, cwd=ROOT, check=True)


def stamp(seconds, ass=False):
    value = round(seconds * (100 if ass else 1000))
    scale = 100 if ass else 1000
    h, value = divmod(value, 3600 * scale)
    m, value = divmod(value, 60 * scale)
    s, part = divmod(value, scale)
    return f"{h}:{m:02}:{s:02}.{part:02}" if ass else f"{h:02}:{m:02}:{s:02},{part:03}"


def wrap_line(text, maximum=43):
    if len(text) <= maximum:
        return text
    cut = max(text.rfind(c, maximum // 2, maximum + 1) for c in "，；。：、")
    cut = cut + 1 if cut >= 0 else maximum
    return text[:cut] + "\n" + wrap_line(text[cut:], maximum)


def main():
    manifest = json.loads((ROOT / "materials/submission-timeline.json").read_text(encoding="utf-8"))
    voices = {v["id"]: v for v in json.loads((ROOT / ".cache/submission-voice/manifest.json").read_text(encoding="utf-8-sig"))}
    scenes = manifest["scenes"]
    assert manifest["blockedRequests"] == 0 and manifest["browserErrors"] == 0
    duration = scenes[-1]["end"] / 1000 + 0.5
    sample_rate = 22050
    audio = bytearray(math.ceil(duration * sample_rate) * 2)
    subtitles = []
    coverage = []
    transcript = ["# 一刻烟火：演示视频旁白与章节", "", "本片采用实际浏览器操作录屏、本机中文语音和逐句字幕。历史接口与微信静帧均在画面标明；录制不新增真实API调用。", ""]
    ass = ["[Script Info]", "ScriptType: v4.00+", "PlayResX: 1600", "PlayResY: 900", "WrapStyle: 2", "", "[V4+ Styles]", "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding", "Style: Spoken,Microsoft YaHei,28,&H00FFFFFF,&H00FFFFFF,&H00383E12,&H00383E12,0,0,0,0,100,100,0,0,1,0,0,8,60,60,10,1", "Style: Chapter,Microsoft YaHei,18,&H00C8E3DA,&H00FFFFFF,&H00383E12,&H00383E12,0,0,0,0,100,100,0,0,1,0,0,8,60,60,10,1", "", "[Events]", "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text"]
    for scene in scenes:
        start, end = scene["start"] / 1000, scene["end"] / 1000
        assert end - start >= voices[scene["id"]]["duration"] - 0.1
        transcript.extend([f"## {stamp(start).split(',')[0]} {scene['title']}", ""])
        ass.append(f"Dialogue: 0,{stamp(start,True)},{stamp(end,True)},Chapter,,0,0,0,,{{\\an8\\pos(800,805)}}{scene['title']}")
        cursor = start + 0.4
        for segment in voices[scene["id"]]["segments"]:
            with wave.open(str(ROOT / segment["file"]), "rb") as wav:
                assert (wav.getframerate(), wav.getnchannels(), wav.getsampwidth()) == (sample_rate, 1, 2)
                frames = wav.readframes(wav.getnframes())
            span = len(frames) / (sample_rate * 2)
            assert cursor + span < end, f"Narration overrun: {scene['id']}"
            offset = round(cursor * sample_rate) * 2
            audio[offset:offset + len(frames)] = frames
            text = wrap_line(segment["text"])
            assert max(map(len, text.splitlines())) <= 43 and len(text.splitlines()) <= 2
            subtitles.append(f"{len(subtitles)+1}\n{stamp(cursor)} --> {stamp(cursor+span)}\n{text}\n")
            escaped = text.replace("\n", "\\N")
            ass.append(f"Dialogue: 1,{stamp(cursor,True)},{stamp(cursor+span,True)},Spoken,,0,0,0,,{{\\an8\\pos(800,836)}}{escaped}")
            coverage.append({"scene": scene["id"], "start": round(cursor, 3), "end": round(cursor + span, 3), "text": segment["text"]})
            transcript.append(segment["text"] + "\n")
            cursor += span + 0.2
    with wave.open(str(ROOT / ".cache/submission-narration.wav"), "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(sample_rate)
        wav.writeframes(audio)
    (ROOT / "materials/yike-yanhuo-submission.srt").write_text("\n".join(subtitles), encoding="utf-8")
    (ROOT / ".cache/submission.ass").write_text("\n".join(ass) + "\n", encoding="utf-8-sig")
    (ROOT / "docs/submission-transcript.md").write_text("\n".join(transcript), encoding="utf-8")
    (ROOT / "materials/submission-caption-timing.json").write_text(json.dumps(coverage, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    run(["ffmpeg", "-hide_banner", "-loglevel", "warning", "-y", "-i", manifest["video"], "-i", ".cache/submission-narration.wav", "-vf", "pad=1600:900:0:0:color=0x123e38,ass=.cache/submission.ass", "-af", "loudnorm=I=-16:TP=-1.5:LRA=7", "-map", "0:v:0", "-map", "1:a:0", "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p", "-r", "25", "-c:a", "aac", "-b:a", "128k", "-ar", "48000", "-ac", "2", "-t", str(duration), "-movflags", "+faststart", "-metadata", "title=一刻烟火：从社区体检，到一趟安心出门", "-metadata", "artist=TingxuanHan", "materials/yike-yanhuo-submission.mp4"])
    run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", "materials/yike-yanhuo-submission.mp4", "-ss", "4", "-frames:v", "1", "materials/yike-yanhuo-submission-cover.png"])
    print(json.dumps({"duration": duration, "scenes": len(scenes), "spokenCaptions": len(coverage), "video": "materials/yike-yanhuo-submission.mp4"}))


if __name__ == "__main__":
    main()
