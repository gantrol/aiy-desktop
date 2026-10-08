# Packaging

[![简体中文](assets/zh-cn.svg)](packaging.md) [![English](assets/en.svg)](packaging.en.md)

The Windows distribution artifact is an x64 Store MSIX. Run these commands from the application root containing [package.json](../package.json).

## Windows build environment

- Windows 10/11 x64, Git, Node.js and npm, with dependencies prepared as described in [Development](development.en.md).
- Visual Studio or Build Tools with the MSVC v143 C++ toolset and Windows SDK. The native update helper builds as `Release|x64`.
- The locked Electron, electron-builder and `@microsoft/winappcli` dependencies. Windows packaging requires the winapp CLI listed under optional dependencies.

Build configuration lives in [electron-builder.yml](../electron-builder.yml), the [MSIX manifest](../build/msix/Package.appxmanifest) and the [packaging script](../scripts/build-store-msix.ps1). The manifest defines the minimum supported Windows version.

## Before packaging

1. Check versions, source files and the intended deliverables using [Releases](release.en.md). Adjust each version once; retries do not require another increment.
2. Confirm that dependencies are complete. Reuse an existing compatible installation; packaging does not inherently require `npm ci`.
3. Run only one packaging task in a checkout. Inspect the destination and preserve any previous artifacts still needed: the script replaces output for the same version and mode.
4. Use clean, committed source for a release. A development checkout can also produce a package, but its actual `sourceDirty` value must remain recorded and does not establish release readiness.

## Windows commands

| Command                    | Purpose                                                                                       |
| -------------------------- | --------------------------------------------------------------------------------------------- |
| `npm run package`          | Full verification, production builds and an unsigned Store submission package                 |
| `npm run make`             | Same as `package`                                                                             |
| `npm run verify:store`     | Full verification separately, including a production build                                    |
| `npm run make:store`       | Prepare Electron, build production output and package it, without repeating full verification |
| `npm run make:store:local` | Produce a locally signed test MSIX without full verification                                  |

For the normal complete flow, run:

```sh
npm run package
```

If the same source, dependencies and environment have already passed full verification, run `npm run make:store`. Avoid running `verify:store` followed by `package`, which repeats verification. In the current complete flow, both verification and packaging build the app; `make:store` still regenerates production output.

`build:unpacked` only produces a temporary application directory. Use MSIX for Windows distribution.

## Outputs and verification

The unsigned submission package is written to:

```text
release/store-msix-<app-version>/submission/
  AIY-<app-version>-store-x64.msix
  build-metadata.json
  SHA256SUMS.txt
  AppxManifest.xml
  AppxBlockMap.xml
```

The packaging script checks identity, version, architecture and protocol declarations in the source and packaged manifests. It also validates the update helper, resource payload and signature state, and generates SHA-256 metadata. It records a dirty checkout but does not reject output automatically when `sourceDirty` is `true`.

Before delivery, verify:

| Field                        | Release submission requirement                                          |
| ---------------------------- | ----------------------------------------------------------------------- |
| `appVersion`, `storeVersion` | Match source and manifest; Store version is `(major + 1).minor.patch.0` |
| `sourceCommit`               | Final commit used for review, verification and packaging                |
| `sourceDirty`                | `false`                                                                 |
| `architecture`               | `x64`                                                                   |
| `signedForLocalTest`         | `false`                                                                 |
| `artifact`, `sha256`         | Match the actual MSIX filename and independently calculated hash        |

Calculate the hash independently in PowerShell and compare it with `build-metadata.json` and `SHA256SUMS.txt`:

```powershell
$appVersion = (Get-Content -Raw -LiteralPath package.json | ConvertFrom-Json).version
$packageDir = Join-Path "release/store-msix-$appVersion" 'submission'
$metadata = Get-Content -Raw -LiteralPath (Join-Path $packageDir 'build-metadata.json') | ConvertFrom-Json
Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $packageDir $metadata.artifact)
Get-Content -LiteralPath (Join-Path $packageDir 'SHA256SUMS.txt')
$metadata
```

Hash checks do not replace functional acceptance. Record fresh installation, upgrade from the previous stable version, data save and recovery, system protocol handoff, and Windows App Certification Kit results separately. Mark anything not performed as unverified. [WACK reference](https://learn.microsoft.com/en-us/windows/uwp/debug-test-perf/windows-app-certification-kit)

## Local validation package

```sh
npm run make:store:local
```

Output is written to `release/store-msix-<app-version>/local-test/`, with `-local-test` in the MSIX filename. This directory may also contain local certificate files; do not include the `.pfx` private key in deliverables.

Use the locally signed package only for validation in an isolated environment, not Store submission. Submit the unsigned MSIX from `submission/`; Microsoft signs it after certification. [Store package requirements](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msix/app-package-requirements)

## Local macOS builds

On macOS, install Xcode Command Line Tools and prepare dependencies as described in Development, then run:

```sh
npm run make:mac
```

Configuration lives in [electron-builder.mac.cjs](../electron-builder.mac.cjs). Output is written to `release/macos/`, producing a DMG for the current machine architecture. Build and validate arm64 and x64 separately. The current configuration uses ad-hoc signing without notarization; a successful build does not establish readiness for public macOS distribution.

## Troubleshooting

| Problem                                    | Action                                                                                                                      |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| Dependency installation fails with `EPERM` | See [dependency management](development.en.md#existing-environments); resolve file locks and interrupted installation first |
| MSBuild, v143 or SDK is missing            | Install the required Windows C++ build components and retry packaging                                                       |
| Manifest version mismatch                  | Correct the version mapping; keep Store identity and Publisher aligned with the registered product                          |
| Verification or payload checks fail        | Fix the reported problem before delivery instead of bypassing checks                                                        |
| The same artifact is needed again          | Check its source metadata and hash first; reuse it when unchanged                                                           |

[Documentation](index.en.md) · [Development](development.en.md) · [Releases](release.en.md)
