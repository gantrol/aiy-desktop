[CmdletBinding()]
param(
  [switch]$LocalTest
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Invoke-CheckedCommand {
  param(
    [Parameter(Mandatory = $true)]
    [string]$FilePath,
    [Parameter(Mandatory = $true)]
    [string[]]$Arguments
  )

  & $FilePath @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "Command failed with exit code ${LASTEXITCODE}: $FilePath $($Arguments -join ' ')"
  }
}

function Assert-Equal {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Label,
    [AllowEmptyString()]
    [string]$Actual,
    [AllowEmptyString()]
    [string]$Expected
  )

  if ($Actual -cne $Expected) {
    throw "$Label mismatch. Expected '$Expected', received '$Actual'."
  }
}

function Assert-AiyProtocolRegistration {
  param(
    [Parameter(Mandatory = $true)]
    [xml]$Manifest,
    [Parameter(Mandatory = $true)]
    [string]$Label
  )

  $namespaces = [System.Xml.XmlNamespaceManager]::new($Manifest.NameTable)
  $namespaces.AddNamespace('foundation', 'http://schemas.microsoft.com/appx/manifest/foundation/windows10')
  $namespaces.AddNamespace('uap', 'http://schemas.microsoft.com/appx/manifest/uap/windows10')
  $protocol = $Manifest.SelectSingleNode(
    '/foundation:Package/foundation:Applications/foundation:Application/foundation:Extensions/uap:Extension[@Category="windows.protocol"]/uap:Protocol[@Name="aiy"]',
    $namespaces
  )
  if ($null -eq $protocol) {
    throw "$Label does not register the aiy URI protocol."
  }
}

function Assert-BuildChildPath {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Path,
    [Parameter(Mandatory = $true)]
    [string]$BuildRoot
  )

  $fullPath = [System.IO.Path]::GetFullPath($Path)
  $fullBuildRoot = [System.IO.Path]::GetFullPath($BuildRoot).TrimEnd([System.IO.Path]::DirectorySeparatorChar)
  $requiredPrefix = $fullBuildRoot + [System.IO.Path]::DirectorySeparatorChar
  if (-not $fullPath.StartsWith($requiredPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to modify a path outside the Store build root: $fullPath"
  }

  return $fullPath
}

function Get-Sha256Hex {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Path
  )

  $algorithm = [System.Security.Cryptography.SHA256]::Create()
  try {
    $stream = [System.IO.File]::OpenRead($Path)
    try {
      $hashBytes = $algorithm.ComputeHash($stream)
    }
    finally {
      $stream.Dispose()
    }
  }
  finally {
    $algorithm.Dispose()
  }

  return (($hashBytes | ForEach-Object { $_.ToString('x2') }) -join '')
}

function Remove-BuildDirectory {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Path,
    [Parameter(Mandatory = $true)]
    [string]$BuildRoot
  )

  $validatedPath = Assert-BuildChildPath -Path $Path -BuildRoot $BuildRoot
  if (Test-Path -LiteralPath $validatedPath) {
    Remove-Item -LiteralPath $validatedPath -Recurse -Force
  }
}

function Resolve-MSBuildPath {
  $vsWherePath = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
  if (-not (Test-Path -LiteralPath $vsWherePath)) {
    throw "Visual Studio Installer discovery tool is missing: $vsWherePath"
  }

  $matches = @(
    & $vsWherePath -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -find 'MSBuild\**\Bin\MSBuild.exe'
  )
  if ($LASTEXITCODE -ne 0 -or $matches.Count -eq 0) {
    throw 'Visual Studio with the MSVC x64 build tools is required to build the Store update helper.'
  }
  return [string]$matches[0]
}

if ($env:OS -ne 'Windows_NT') {
  throw 'Microsoft Store MSIX packages must be built on Windows.'
}

$repositoryRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$packageJsonPath = Join-Path $repositoryRoot 'package.json'
$manifestPath = Join-Path $repositoryRoot 'build\msix\Package.appxmanifest'
$assetDirectory = Join-Path $repositoryRoot 'build\msix\Assets'
$storeUpdateProject = Join-Path $repositoryRoot 'native\store-update-helper\store-update-helper.vcxproj'
$electronBuilder = Join-Path $repositoryRoot 'node_modules\.bin\electron-builder.cmd'
$winApp = Join-Path $repositoryRoot 'node_modules\.bin\winapp.cmd'

foreach ($requiredPath in @($packageJsonPath, $manifestPath, $assetDirectory, $storeUpdateProject, $electronBuilder, $winApp)) {
  if (-not (Test-Path -LiteralPath $requiredPath)) {
    throw "Required Store build input is missing: $requiredPath"
  }
}

$packageJson = Get-Content -LiteralPath $packageJsonPath -Raw | ConvertFrom-Json
$versionMatch = [regex]::Match([string]$packageJson.version, '^(?<major>\d+)\.(?<minor>\d+)\.(?<patch>\d+)$')
if (-not $versionMatch.Success) {
  throw "Store builds require a stable three-part package.json version, received '$($packageJson.version)'."
}

$semanticMajor = [int]$versionMatch.Groups['major'].Value
$semanticMinor = [int]$versionMatch.Groups['minor'].Value
$semanticPatch = [int]$versionMatch.Groups['patch'].Value
$storeFields = @(($semanticMajor + 1), $semanticMinor, $semanticPatch, 0)
if ($storeFields | Where-Object { $_ -lt 0 -or $_ -gt 65535 }) {
  throw "The computed Store version contains a field outside 0..65535: $($storeFields -join '.')"
}

$appVersion = [string]$packageJson.version
$storeVersion = $storeFields -join '.'
$expectedIdentityName = 'Gantrol.AIY'
$expectedPublisher = 'CN=C15001B6-7C6F-41AE-9600-3F68EF6CBD5A'
$expectedPublisherDisplayName = 'Gantrol'

[xml]$sourceManifest = Get-Content -LiteralPath $manifestPath -Raw
Assert-Equal -Label 'Identity.Name' -Actual ([string]$sourceManifest.Package.Identity.Name) -Expected $expectedIdentityName
Assert-Equal -Label 'Identity.Publisher' -Actual ([string]$sourceManifest.Package.Identity.Publisher) -Expected $expectedPublisher
Assert-Equal -Label 'Identity.Version' -Actual ([string]$sourceManifest.Package.Identity.Version) -Expected $storeVersion
Assert-Equal -Label 'Identity.ProcessorArchitecture' -Actual ([string]$sourceManifest.Package.Identity.ProcessorArchitecture) -Expected 'x64'
Assert-Equal -Label 'Properties.DisplayName' -Actual ([string]$sourceManifest.Package.Properties.DisplayName) -Expected 'AIY'
Assert-Equal -Label 'Properties.PublisherDisplayName' -Actual ([string]$sourceManifest.Package.Properties.PublisherDisplayName) -Expected $expectedPublisherDisplayName
Assert-AiyProtocolRegistration -Manifest $sourceManifest -Label 'Source manifest'

$buildRoot = Join-Path $repositoryRoot "release\store-msix-$appVersion"
$modeName = if ($LocalTest) { 'local-test' } else { 'submission' }
$modeRoot = Join-Path $buildRoot $modeName
$electronBuilderOutput = Join-Path $modeRoot 'electron-builder'
$nativeBuildDirectory = Join-Path $modeRoot 'store-update-helper-build'
$nativeOutputDirectory = Join-Path $nativeBuildDirectory 'out'
$nativeIntermediateDirectory = Join-Path $nativeBuildDirectory 'obj'
$stagingDirectory = Join-Path $modeRoot 'staging'
$inspectionDirectory = Join-Path $modeRoot 'inspection'
$certificateDirectory = Join-Path $modeRoot 'certificate'
$artifactSuffix = if ($LocalTest) { '-local-test' } else { '' }
$artifactPath = Join-Path $modeRoot "AIY-$appVersion-store-x64$artifactSuffix.msix"

if (-not (Test-Path -LiteralPath $buildRoot)) {
  New-Item -ItemType Directory -Path $buildRoot | Out-Null
}
$validatedModeRoot = Assert-BuildChildPath -Path $modeRoot -BuildRoot $buildRoot
if (Test-Path -LiteralPath $validatedModeRoot) {
  Remove-Item -LiteralPath $validatedModeRoot -Recurse -Force
}
New-Item -ItemType Directory -Path $validatedModeRoot | Out-Null

$msBuild = Resolve-MSBuildPath
Write-Host "Building the Microsoft Store update helper for AIY $appVersion..."
Invoke-CheckedCommand -FilePath $msBuild -Arguments @(
  $storeUpdateProject,
  '/nologo',
  '/m',
  '/p:Configuration=Release',
  '/p:Platform=x64',
  "/p:OutDir=$nativeOutputDirectory$([System.IO.Path]::DirectorySeparatorChar)",
  "/p:IntDir=$nativeIntermediateDirectory$([System.IO.Path]::DirectorySeparatorChar)"
)

$compiledStoreUpdateHelper = Join-Path $nativeOutputDirectory 'aiy-store-update.exe'
if (-not (Test-Path -LiteralPath $compiledStoreUpdateHelper)) {
  throw "The Store update helper build did not produce the expected executable: $compiledStoreUpdateHelper"
}
$protocolOutput = @(& $compiledStoreUpdateHelper protocol-version)
if ($LASTEXITCODE -ne 0 -or $protocolOutput.Count -ne 1) {
  throw 'The Store update helper protocol validation command failed.'
}
try {
  $helperProtocol = $protocolOutput[0] | ConvertFrom-Json
}
catch {
  throw 'The Store update helper returned malformed protocol metadata.'
}
Assert-Equal -Label 'Store update helper protocol type' -Actual ([string]$helperProtocol.type) -Expected 'protocol'
Assert-Equal -Label 'Store update helper protocol version' -Actual ([string]$helperProtocol.version) -Expected '2'

Write-Host "Building Electron x64 layout for AIY $appVersion..."
Invoke-CheckedCommand -FilePath $electronBuilder -Arguments @(
  '--dir',
  '--win',
  '--x64',
  '--publish',
  'never',
  "--config.directories.output=$electronBuilderOutput"
)

$unpackedDirectory = Join-Path $electronBuilderOutput 'win-unpacked'
if (-not (Test-Path -LiteralPath (Join-Path $unpackedDirectory 'aiy.exe'))) {
  throw "Electron Builder did not produce the expected executable: $unpackedDirectory\aiy.exe"
}

New-Item -ItemType Directory -Path $stagingDirectory | Out-Null
Get-ChildItem -LiteralPath $unpackedDirectory -Force | Copy-Item -Destination $stagingDirectory -Recurse -Force
Copy-Item -LiteralPath $assetDirectory -Destination (Join-Path $stagingDirectory 'Assets') -Recurse -Force
$storeUpdateResourceDirectory = Join-Path $stagingDirectory 'resources\store-update'
New-Item -ItemType Directory -Path $storeUpdateResourceDirectory | Out-Null
Copy-Item -LiteralPath $compiledStoreUpdateHelper -Destination (Join-Path $storeUpdateResourceDirectory 'aiy-store-update.exe') -Force

$contentPackRoot = Join-Path $stagingDirectory 'resources\content-packs'
$bundledContentPacks = @(
  Get-ChildItem -LiteralPath $contentPackRoot -Directory -ErrorAction Stop | Select-Object -ExpandProperty Name
)
if ($bundledContentPacks.Count -ne 1 -or $bundledContentPacks[0] -cne 'creation-starter') {
  throw "Store package contains unexpected content packs: $($bundledContentPacks -join ', ')"
}

$packageArguments = @(
  'package',
  $stagingDirectory,
  '--manifest',
  $manifestPath,
  '--output',
  $artifactPath,
  '--executable',
  'aiy.exe'
)

if ($LocalTest) {
  New-Item -ItemType Directory -Path $certificateDirectory | Out-Null
  $certificatePath = Join-Path $certificateDirectory 'AIY-Store-Local-Test.pfx'
  $certificatePassword = 'AIY-Store-Local-Test'
  Invoke-CheckedCommand -FilePath $winApp -Arguments @(
    'cert',
    'generate',
    '--manifest',
    $manifestPath,
    '--output',
    $certificatePath,
    '--password',
    $certificatePassword,
    '--valid-days',
    '30',
    '--export-cer',
    '--if-exists',
    'Overwrite'
  )
  $packageArguments += @('--cert', $certificatePath, '--cert-password', $certificatePassword)
}

Write-Host "Creating $(if ($LocalTest) { 'local-test signed' } else { 'unsigned Store submission' }) MSIX..."
Invoke-CheckedCommand -FilePath $winApp -Arguments $packageArguments

New-Item -ItemType Directory -Path $inspectionDirectory | Out-Null
Invoke-CheckedCommand -FilePath $winApp -Arguments @(
  'tool',
  'makeappx',
  'unpack',
  '/p',
  $artifactPath,
  '/d',
  $inspectionDirectory,
  '/o'
)

$packedManifestPath = Join-Path $inspectionDirectory 'AppxManifest.xml'
Invoke-CheckedCommand -FilePath 'node' -Arguments @(
  (Join-Path $PSScriptRoot 'verify-store-payload.mjs'),
  $inspectionDirectory
)
[xml]$packedManifest = Get-Content -LiteralPath $packedManifestPath -Raw
Assert-Equal -Label 'Packed Identity.Name' -Actual ([string]$packedManifest.Package.Identity.Name) -Expected $expectedIdentityName
Assert-Equal -Label 'Packed Identity.Publisher' -Actual ([string]$packedManifest.Package.Identity.Publisher) -Expected $expectedPublisher
Assert-Equal -Label 'Packed Identity.Version' -Actual ([string]$packedManifest.Package.Identity.Version) -Expected $storeVersion
Assert-Equal -Label 'Packed Identity.ProcessorArchitecture' -Actual ([string]$packedManifest.Package.Identity.ProcessorArchitecture) -Expected 'x64'
Assert-AiyProtocolRegistration -Manifest $packedManifest -Label 'Packed manifest'

if (Test-Path -LiteralPath (Join-Path $inspectionDirectory 'resources\content-packs\human-portrait')) {
  throw 'The Store package contains the prohibited production human-portrait content pack.'
}
if (Test-Path -LiteralPath (Join-Path $inspectionDirectory 'Package.appxmanifest')) {
  throw 'The source Package.appxmanifest was accidentally included as application payload.'
}
$packedStoreUpdateHelper = Join-Path $inspectionDirectory 'resources\store-update\aiy-store-update.exe'
if (-not (Test-Path -LiteralPath $packedStoreUpdateHelper)) {
  throw 'The Store package is missing the native update helper.'
}
$packedProtocolOutput = @(& $packedStoreUpdateHelper protocol-version)
if ($LASTEXITCODE -ne 0 -or $packedProtocolOutput.Count -ne 1) {
  throw 'The packed Store update helper protocol validation command failed.'
}
try {
  $packedHelperProtocol = $packedProtocolOutput[0] | ConvertFrom-Json
}
catch {
  throw 'The packed Store update helper returned malformed protocol metadata.'
}
Assert-Equal -Label 'Packed Store update helper protocol type' -Actual ([string]$packedHelperProtocol.type) -Expected 'protocol'
Assert-Equal -Label 'Packed Store update helper protocol version' -Actual ([string]$packedHelperProtocol.version) -Expected '2'

$signaturePath = Join-Path $inspectionDirectory 'AppxSignature.p7x'
if ($LocalTest -and -not (Test-Path -LiteralPath $signaturePath)) {
  throw 'The local-test package was not signed.'
}
if (-not $LocalTest -and (Test-Path -LiteralPath $signaturePath)) {
  throw 'The Store submission package was unexpectedly signed.'
}

Copy-Item -LiteralPath $packedManifestPath -Destination (Join-Path $modeRoot 'AppxManifest.xml') -Force
Copy-Item -LiteralPath (Join-Path $inspectionDirectory 'AppxBlockMap.xml') -Destination (Join-Path $modeRoot 'AppxBlockMap.xml') -Force

$artifactHash = Get-Sha256Hex -Path $artifactPath
$sourceCommit = (& git -C $repositoryRoot rev-parse HEAD).Trim()
$sourceDirty = [bool](& git -C $repositoryRoot status --porcelain --untracked-files=all)
$metadata = [ordered]@{
  appVersion = $appVersion
  storeVersion = $storeVersion
  identityName = $expectedIdentityName
  publisher = $expectedPublisher
  publisherDisplayName = $expectedPublisherDisplayName
  architecture = 'x64'
  deviceFamily = 'Windows.Desktop'
  storeUpdateProtocolVersion = 2
  signedForLocalTest = [bool]$LocalTest
  sourceCommit = $sourceCommit
  sourceDirty = $sourceDirty
  sha256 = $artifactHash
  artifact = [System.IO.Path]::GetFileName($artifactPath)
}

[System.IO.File]::WriteAllText(
  (Join-Path $modeRoot 'build-metadata.json'),
  (($metadata | ConvertTo-Json -Depth 3) + [Environment]::NewLine),
  [System.Text.UTF8Encoding]::new($false)
)
[System.IO.File]::WriteAllText(
  (Join-Path $modeRoot 'SHA256SUMS.txt'),
  "$artifactHash  $([System.IO.Path]::GetFileName($artifactPath))$([Environment]::NewLine)",
  [System.Text.UTF8Encoding]::new($false)
)

Remove-BuildDirectory -Path $stagingDirectory -BuildRoot $modeRoot
Remove-BuildDirectory -Path $inspectionDirectory -BuildRoot $modeRoot
Remove-BuildDirectory -Path $electronBuilderOutput -BuildRoot $modeRoot
Remove-BuildDirectory -Path $nativeBuildDirectory -BuildRoot $modeRoot

Write-Host ''
Write-Host "MSIX ready: $artifactPath"
Write-Host "Identity: $expectedIdentityName"
Write-Host "App version: $appVersion"
Write-Host "Store version: $storeVersion"
Write-Host "SHA256: $artifactHash"
if ($LocalTest) {
  Write-Warning 'This package is for local sideloading only. Trust the exported .cer, never upload the PFX, and do not submit the local-test MSIX to Partner Center.'
} else {
  Write-Host 'This unsigned package is intended for Partner Center, where Microsoft signs it after certification.'
}
