import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, link, mkdir, mkdtemp, readdir, readFile, rename, rm, stat, symlink } from 'node:fs/promises';
import path from 'node:path';

const BRANDING_SCHEMA_VERSION = 1;

async function fileInformation(file) {
  const information = await stat(file);
  if (!information.isFile()) throw new Error(`Expected a file: ${file}`);
  return information;
}

async function fileExists(file) {
  try {
    return (await stat(file)).isFile();
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

async function installedElectronExecutable(applicationRoot) {
  const electronRoot = path.join(applicationRoot, 'node_modules', 'electron');
  const executableName = (await readFile(path.join(electronRoot, 'path.txt'), 'utf8')).trim();
  if (!executableName) throw new Error('Electron path.txt does not name an executable.');
  const distributionRoot = process.env.ELECTRON_OVERRIDE_DIST_PATH
    ? path.resolve(applicationRoot, process.env.ELECTRON_OVERRIDE_DIST_PATH)
    : path.join(electronRoot, 'dist');
  return path.join(distributionRoot, executableName);
}

async function linkRuntimeDependencies(distributionRoot, runtimeRoot) {
  const entries = await readdir(distributionRoot, { withFileTypes: true });
  for (const entry of entries) {
    if (/trash/i.test(entry.name) || /^(?:electron\.exe|\.?aiy-development-)/i.test(entry.name)) continue;
    const source = path.join(distributionRoot, entry.name);
    const destination = path.join(runtimeRoot, entry.name);
    if (entry.isDirectory()) {
      await symlink(source, destination, 'junction');
    } else if (entry.isFile()) {
      try {
        await link(source, destination);
      } catch (error) {
        if (!['EXDEV', 'EPERM', 'ENOTSUP'].includes(error.code)) throw error;
        await copyFile(source, destination);
      }
    }
  }
}

async function runResourceEditor(resourceEditor, executable, icon, version, originalFilename) {
  const metadata = {
    CompanyName: 'AIY',
    FileDescription: 'AIY Development',
    InternalName: 'aiy-development',
    OriginalFilename: originalFilename,
    ProductName: 'AIY Development',
  };
  const arguments_ = [executable, '--set-icon', icon, '--set-file-version', version, '--set-product-version', version];
  for (const [name, value] of Object.entries(metadata)) {
    arguments_.push('--set-version-string', name, value);
  }

  await new Promise((resolve, reject) => {
    const child = spawn(resourceEditor, arguments_, {
      stdio: 'inherit',
      windowsHide: true,
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`rcedit failed${signal ? ` with signal ${signal}` : ` with exit code ${code ?? 1}`}.`));
    });
  });
}

export async function resolveDevelopmentElectronExecutable(applicationRoot) {
  if (process.env.ELECTRON_EXEC_PATH) {
    return path.resolve(applicationRoot, process.env.ELECTRON_EXEC_PATH);
  }

  const electronExecutable = await installedElectronExecutable(applicationRoot);
  if (process.platform !== 'win32') return electronExecutable;

  const icon = path.join(applicationRoot, 'build', 'icon.ico');
  const resourceEditor = path.join(applicationRoot, 'node_modules', 'electron-winstaller', 'vendor', 'rcedit.exe');
  const packageJsonPath = path.join(applicationRoot, 'package.json');
  const [electronInformation, iconContents, resourceEditorInformation, packageJsonContents] = await Promise.all([
    fileInformation(electronExecutable),
    readFile(icon),
    fileInformation(resourceEditor),
    readFile(packageJsonPath, 'utf8'),
  ]);
  const { version } = JSON.parse(packageJsonContents);
  if (typeof version !== 'string' || !/^\d+(?:\.\d+){0,3}$/.test(version)) {
    throw new Error(`Cannot brand the development executable with package version ${JSON.stringify(version)}.`);
  }

  const fingerprint = createHash('sha256')
    .update(
      JSON.stringify({
        schema: BRANDING_SCHEMA_VERSION,
        electron: [electronInformation.size, electronInformation.mtimeMs, electronInformation.ctimeMs],
        resourceEditor: [resourceEditorInformation.size, resourceEditorInformation.mtimeMs],
        version,
      }),
    )
    .update(iconContents)
    .digest('hex')
    .slice(0, 16);
  // Electron determines app.isPackaged from the executable's basename. Keep
  // electron.exe and put the icon fingerprint in its directory instead.
  const executableName = 'electron.exe';
  const cacheRoot = path.resolve(applicationRoot, '.tmp', 'development-electron');
  const runtimeRoot = path.join(cacheRoot, `aiy-development-${fingerprint}`);
  const brandedExecutable = path.join(runtimeRoot, executableName);
  if (await fileExists(brandedExecutable)) return brandedExecutable;

  // Only copy the executable we edit. Share unchanged runtime dependencies and
  // publish the complete directory atomically, including for concurrent starts.
  await mkdir(cacheRoot, { recursive: true });
  const temporaryRoot = await mkdtemp(path.join(cacheRoot, '.prepare-'));
  if (
    path.dirname(path.resolve(temporaryRoot)) !== cacheRoot ||
    !path.basename(temporaryRoot).startsWith('.prepare-')
  ) {
    throw new Error('Runtime preparation directory is outside the preparation cache.');
  }
  const temporaryExecutable = path.join(temporaryRoot, executableName);
  try {
    await linkRuntimeDependencies(path.dirname(electronExecutable), temporaryRoot);
    await copyFile(electronExecutable, temporaryExecutable);
    await runResourceEditor(resourceEditor, temporaryExecutable, icon, version, executableName);
    try {
      await rename(temporaryRoot, runtimeRoot);
    } catch (error) {
      if (!(await fileExists(brandedExecutable))) throw error;
    }
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
  return brandedExecutable;
}
