$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
try {
    Add-Type -AssemblyName System.Runtime.WindowsRuntime
    $null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
    $null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Foundation, ContentType = WindowsRuntime]
    $null = [Windows.Graphics.Imaging.SoftwareBitmap, Windows.Foundation, ContentType = WindowsRuntime]
    $null = [Windows.Storage.Streams.InMemoryRandomAccessStream, Windows.Foundation, ContentType = WindowsRuntime]
    $null = [Windows.Storage.Streams.DataWriter, Windows.Foundation, ContentType = WindowsRuntime]
    $asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
        $_.Name -eq 'AsTask' -and $_.IsGenericMethod -and $_.GetParameters().Count -eq 1 -and
        $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
    } | Select-Object -First 1
    function AwaitOperation($operation, $resultType) {
        $task = $asTask.MakeGenericMethod($resultType).Invoke($null, @($operation))
        $task.GetAwaiter().GetResult()
    }
    $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
    if ($null -eq $engine) {
        [Console]::WriteLine('{"status":"unavailable"}')
        exit 0
    }
    $encoded = [Console]::ReadLine()
    if ($encoded.Length -gt 34952536) { throw 'Input limit' }
    $bytes = [Convert]::FromBase64String($encoded)
    $stream = [Windows.Storage.Streams.InMemoryRandomAccessStream]::new()
    $writer = [Windows.Storage.Streams.DataWriter]::new($stream)
    $writer.WriteBytes($bytes)
    $null = AwaitOperation ($writer.StoreAsync()) ([uint32])
    $null = $writer.DetachStream()
    $writer.Dispose()
    $stream.Seek(0)
    $decoder = AwaitOperation ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
    $limit = [Windows.Media.Ocr.OcrEngine]::MaxImageDimension
    if ($decoder.PixelWidth -gt $limit -or $decoder.PixelHeight -gt $limit -or ([long]$decoder.PixelWidth * $decoder.PixelHeight) -gt 32000000) {
        [Console]::WriteLine('{"status":"tooLarge"}')
        exit 0
    }
    $bitmap = AwaitOperation ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
    $result = AwaitOperation ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
    $wordCount = 0
    $lines = @($result.Lines | ForEach-Object {
        $lineText = $_.Text
        $words = @($_.Words | ForEach-Object {
            $wordCount++
            if ($wordCount -gt 10000 -or $_.Text.Length -gt 1000) { throw 'Output limit' }
            $box = $_.BoundingRect
            @{ text = $_.Text; x = $box.X; y = $box.Y; width = $box.Width; height = $box.Height }
        })
        @{ words = $words; text = $lineText }
    })
    [Console]::WriteLine((@{ status = 'ready'; angle = [double]$result.TextAngle; lines = $lines } | ConvertTo-Json -Depth 6 -Compress))
} catch {
    # Do not return native errors, recognized text, or image data in diagnostics.
    [Console]::WriteLine('{"status":"failed"}')
} finally {
    if ($null -ne $bitmap) { $bitmap.Dispose() }
    if ($null -ne $stream) { $stream.Dispose() }
}
