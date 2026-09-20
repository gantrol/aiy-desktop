[CmdletBinding()]
param(
  [switch]$SkipTypecheck,
  [switch]$SkipTests
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$desktopRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $desktopRoot

$productionCandidates = @(
  'src/main/video-documents',
  'src/main/database/video-documents',
  'src/main/database/video-document-generation-run-repository.ts',
  'src/main/database/video-document-navigation-repository.ts',
  'src/main/database/video-document-repository.ts',
  'src/main/extensions/codex-app-server',
  'src/renderer/features/video-documents',
  'src/shared/contracts/video-document.ts'
)

# The repository is moving focused database modules into domain directories.
# Keep this user-run verifier valid on either side of that mechanical move.
$productionFiles = @($productionCandidates | Where-Object { Test-Path -LiteralPath $_ })

$componentTests = @(
  'tests/video-document-article.dom.test.tsx',
  'tests/video-document-export-menu.dom.test.tsx',
  'tests/video-document-workspace-components.dom.test.tsx',
  'tests/video-key-change-panel.dom.test.tsx'
)

$unitTests = @(
  'tests/codex-app-server-protocol.test.ts',
  'tests/video-document-export.test.ts',
  'tests/video-key-change-selection.test.ts'
)

$allScopedFiles = $productionFiles + $componentTests + $unitTests

function Assert-LastExitCode([string]$step) {
  if ($LASTEXITCODE -ne 0) {
    throw "$step failed with exit code $LASTEXITCODE."
  }
}

Write-Host 'Checking video-document formatting...'
& npx.cmd prettier --check @allScopedFiles
Assert-LastExitCode 'Prettier check'

Write-Host 'Linting video-document files...'
& npx.cmd eslint @allScopedFiles
Assert-LastExitCode 'ESLint'

if (-not $SkipTypecheck) {
  Write-Host 'Running TypeScript typecheck...'
  & npm.cmd run typecheck
  Assert-LastExitCode 'Typecheck'
}

if (-not $SkipTests) {
  Write-Host 'Running focused unit tests...'
  & npx.cmd vitest run --project unit @unitTests
  Assert-LastExitCode 'Focused unit tests'

  Write-Host 'Running focused component tests...'
  & npx.cmd vitest run --project component @componentTests
  Assert-LastExitCode 'Focused component tests'
}

Write-Host 'Video-document workspace verification completed.'
