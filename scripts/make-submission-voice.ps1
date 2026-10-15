param([string]$Voice = 'Huihui', [int]$Rate = 0)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$voiceRoot = Join-Path $projectRoot '.cache/submission-voice'
New-Item -ItemType Directory -Path $voiceRoot -Force | Out-Null
$story = Get-Content -LiteralPath (Join-Path $projectRoot 'docs/submission-video.json') -Raw | ConvertFrom-Json
$speaker = New-Object -ComObject SAPI.SpVoice
$selected = New-Object -ComObject SAPI.SpObjectToken
$selected.SetId(('HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\Speech_OneCore\Voices\Tokens\MSTTS_V110_zhCN_' + $Voice + 'M'), '', $false)
$speaker.Voice = $selected
$speaker.Rate = $Rate
$speaker.Volume = 100
$manifest = @()
foreach ($scene in $story.scenes) {
    $segments = @()
    $index = 0
    foreach ($line in $scene.lines) {
        $fileName = '{0}-{1:d2}.wav' -f $scene.id,$index
        $outputPath = Join-Path $voiceRoot $fileName
        $stream = New-Object -ComObject SAPI.SpFileStream
        $stream.Format.Type = 22
        $stream.Open($outputPath, 3, $false)
        $speaker.AudioOutputStream = $stream
        [void]$speaker.Speak($line, 0)
        $stream.Close()
        $durationText = & ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 $outputPath
        if ($LASTEXITCODE -ne 0) { throw 'Failed to inspect narration duration.' }
        $duration = [double]::Parse(($durationText | Out-String).Trim(), [Globalization.CultureInfo]::InvariantCulture)
        $segments += @{text=$line; file=('.cache/submission-voice/'+$fileName); duration=$duration}
        $index++
    }
    $manifest += @{id=$scene.id; title=$scene.title; segments=$segments; duration=(($segments | Measure-Object duration -Sum).Sum + 1.4)}
    Write-Output ('Prepared narration: {0}' -f $scene.id)
}
$manifest | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $voiceRoot 'manifest.json') -Encoding utf8
Write-Output ('Narration scenes: {0}' -f $manifest.Count)
