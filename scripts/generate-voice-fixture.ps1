$ErrorActionPreference = 'Stop'
$fixtureRoot = Join-Path (Split-Path -Parent $PSScriptRoot) '.cache'
[System.IO.Directory]::CreateDirectory($fixtureRoot) | Out-Null
$fixturePath = Join-Path $fixtureRoot 'voice-fixture.wav'
Add-Type -AssemblyName System.Speech
$speaker = [System.Speech.Synthesis.SpeechSynthesizer]::new()
try {
    $chineseVoice = $speaker.GetInstalledVoices() | Where-Object { $_.Enabled -and $_.VoiceInfo.Culture.Name -eq 'zh-CN' } | Select-Object -First 1
    if (-not $chineseVoice) { throw 'Install a Windows zh-CN speech voice before generating the synthetic fixture.' }
    $speaker.SelectVoice($chineseVoice.VoiceInfo.Name)
    $speaker.Rate = -1
    $format = [System.Speech.AudioFormat.SpeechAudioFormatInfo]::new(16000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)
    $speaker.SetOutputToWaveFile($fixturePath, $format)
    $speaker.Speak('预算改成三十元，药先不取了，四十五分钟内回来。')
    $speaker.SetOutputToNull()
    [pscustomobject]@{ syntheticFixture = $fixturePath; bytes = (Get-Item -LiteralPath $fixturePath).Length } | ConvertTo-Json
} finally {
    $speaker.Dispose()
}
