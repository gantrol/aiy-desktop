import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, open, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import {
  browserCompanionBrowserIdSchema,
  browserCompanionDestinationSchema,
  browserCompanionDestinationsResultSchema,
  browserCompanionProfileSchema,
  type BrowserCompanionBrowser,
  type BrowserCompanionBrowserId,
  type BrowserCompanionBrowserOpenError,
  type BrowserCompanionDestinationsResult,
  type BrowserCompanionTarget,
} from '@/shared/contracts/browser-companion';

const MAX_LOCAL_STATE_BYTES = 8 * 1024 * 1024;
const MAX_PREFERENCES_BYTES = 32 * 1024 * 1024;
const MAX_PROFILES_PER_BROWSER = 100;
const EXTENSION_ID = 'eagfpifnbkfmojcjfbababmlmagmdopg';

interface BrowserDefinition {
  id: BrowserCompanionBrowserId;
  name: string;
  executableOverride: string;
  userDataOverride: string;
  executableCandidates(environment: NodeJS.ProcessEnv): Array<string | undefined>;
  defaultUserDataRoot(environment: NodeJS.ProcessEnv): string | null;
}

const BROWSER_DEFINITIONS: readonly BrowserDefinition[] = [
  {
    id: 'chrome',
    name: 'Google Chrome',
    executableOverride: 'AIY_BROWSER_COMPANION_CHROME_EXECUTABLE',
    userDataOverride: 'AIY_BROWSER_COMPANION_CHROME_USER_DATA_DIR',
    executableCandidates: (environment) => [
      environment.LOCALAPPDATA
        ? path.join(environment.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe')
        : undefined,
      environment.ProgramFiles
        ? path.join(environment.ProgramFiles, 'Google', 'Chrome', 'Application', 'chrome.exe')
        : undefined,
      environment['ProgramFiles(x86)']
        ? path.join(environment['ProgramFiles(x86)'], 'Google', 'Chrome', 'Application', 'chrome.exe')
        : undefined,
    ],
    defaultUserDataRoot: (environment) =>
      environment.LOCALAPPDATA
        ? path.join(path.resolve(environment.LOCALAPPDATA), 'Google', 'Chrome', 'User Data')
        : null,
  },
  {
    id: 'edge',
    name: 'Microsoft Edge',
    executableOverride: 'AIY_BROWSER_COMPANION_EDGE_EXECUTABLE',
    userDataOverride: 'AIY_BROWSER_COMPANION_EDGE_USER_DATA_DIR',
    executableCandidates: (environment) => [
      environment.LOCALAPPDATA
        ? path.join(environment.LOCALAPPDATA, 'Microsoft', 'Edge', 'Application', 'msedge.exe')
        : undefined,
      environment.ProgramFiles
        ? path.join(environment.ProgramFiles, 'Microsoft', 'Edge', 'Application', 'msedge.exe')
        : undefined,
      environment['ProgramFiles(x86)']
        ? path.join(environment['ProgramFiles(x86)'], 'Microsoft', 'Edge', 'Application', 'msedge.exe')
        : undefined,
    ],
    defaultUserDataRoot: (environment) =>
      environment.LOCALAPPDATA
        ? path.join(path.resolve(environment.LOCALAPPDATA), 'Microsoft', 'Edge', 'User Data')
        : null,
  },
];

const localStateSchema = z
  .object({
    profile: z
      .object({
        info_cache: z.record(z.string(), z.unknown()),
      })
      .passthrough(),
  })
  .passthrough();

const profileInfoSchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
  })
  .passthrough();

const preferencesSchema = z
  .object({
    extensions: z
      .object({
        settings: z.record(z.string(), z.unknown()),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

const extensionSettingSchema = z
  .object({
    state: z.number().int().optional(),
    disable_reasons: z.array(z.number().int()).max(100).optional(),
    path: z.string().trim().min(1).max(2_048).optional(),
  })
  .passthrough();

const routesSchema = z
  .object({
    chatgpt: browserCompanionDestinationSchema.nullable(),
    wechat: browserCompanionDestinationSchema.nullable(),
    weibo: browserCompanionDestinationSchema.nullable(),
  })
  .strict();

const selectionSchema = z
  .object({
    schemaVersion: z.literal(3),
    routes: routesSchema,
  })
  .strict();

const previousSelectionSchema = z
  .object({
    schemaVersion: z.literal(2),
    routes: z
      .object({
        chatgpt: browserCompanionDestinationSchema.nullable(),
        weibo: browserCompanionDestinationSchema.nullable(),
      })
      .strict(),
  })
  .strict();

const legacySelectionSchema = z
  .object({
    schemaVersion: z.literal(1),
    selectedProfileDirectory: browserCompanionProfileSchema.shape.directory,
  })
  .strict();

type BrowserCompanionRoutes = z.infer<typeof routesSchema>;

const EMPTY_ROUTES: BrowserCompanionRoutes = { chatgpt: null, wechat: null, weibo: null };

function hasErrorCode(reason: unknown, code: string): boolean {
  return reason instanceof Error && 'code' in reason && Reflect.get(reason, 'code') === code;
}

async function readBoundedJson(filePath: string, maxBytes: number): Promise<unknown | null> {
  let handle: Awaited<ReturnType<typeof open>>;
  try {
    handle = await open(filePath, 'r');
  } catch (reason) {
    if (hasErrorCode(reason, 'ENOENT')) return null;
    throw reason;
  }
  try {
    const metadata = await handle.stat();
    if (!metadata.isFile() || metadata.size <= 0 || metadata.size > maxBytes) return null;
    const bytes = Buffer.alloc(metadata.size);
    let offset = 0;
    while (offset < bytes.length) {
      const result = await handle.read(bytes, offset, bytes.length - offset, offset);
      if (result.bytesRead === 0) return null;
      offset += result.bytesRead;
    }
    try {
      return JSON.parse(bytes.toString('utf8')) as unknown;
    } catch {
      return null;
    }
  } finally {
    await handle.close();
  }
}

async function existingFile(candidate: string | undefined): Promise<string | null> {
  const value = candidate?.trim();
  if (!value) return null;
  const resolved = path.resolve(value);
  try {
    return (await stat(resolved)).isFile() ? resolved : null;
  } catch {
    return null;
  }
}

async function existingDirectory(candidate: string): Promise<boolean> {
  try {
    return (await stat(candidate)).isDirectory();
  } catch {
    return false;
  }
}

function pathsMatch(left: string, right: string, platform: NodeJS.Platform): boolean {
  const normalizedLeft = path.normalize(path.resolve(left));
  const normalizedRight = path.normalize(path.resolve(right));
  return platform === 'win32'
    ? normalizedLeft.toLocaleLowerCase() === normalizedRight.toLocaleLowerCase()
    : normalizedLeft === normalizedRight;
}

export class BrowserCompanionLaunchError extends Error {
  constructor(
    readonly code: BrowserCompanionBrowserOpenError,
    message: string,
  ) {
    super(message);
    this.name = 'BrowserCompanionLaunchError';
  }
}

export class BrowserCompanionBrowserController {
  private readonly selectionPath: string;
  private readonly legacySelectionPath: string;
  private selectionMutation: Promise<void> = Promise.resolve();

  constructor(
    private readonly options: {
      dataPath: string;
      environment: NodeJS.ProcessEnv;
      platform: NodeJS.Platform;
      prepareLaunchUrl(target: BrowserCompanionTarget, destinationUrl: string): string;
    },
  ) {
    this.selectionPath = path.join(options.dataPath, 'browser-destinations.json');
    this.legacySelectionPath = path.join(options.dataPath, 'chrome-profile.json');
  }

  private definition(browserId: BrowserCompanionBrowserId): BrowserDefinition {
    const definition = BROWSER_DEFINITIONS.find((candidate) => candidate.id === browserId);
    if (!definition) throw new BrowserCompanionLaunchError('BROWSER_NOT_FOUND', 'Browser is unsupported');
    return definition;
  }

  private userDataRoot(definition: BrowserDefinition): string | null {
    const override = this.options.environment[definition.userDataOverride]?.trim();
    return override ? path.resolve(override) : definition.defaultUserDataRoot(this.options.environment);
  }

  private async executable(definition: BrowserDefinition): Promise<string | null> {
    if (this.options.platform !== 'win32') return null;
    const candidates = [
      this.options.environment[definition.executableOverride],
      ...definition.executableCandidates(this.options.environment),
    ];
    for (const candidate of candidates) {
      const executable = await existingFile(candidate);
      if (executable) return executable;
    }
    return null;
  }

  private async extensionInstalled(profilePath: string): Promise<boolean> {
    const developmentDirectory = this.options.environment.AIY_BROWSER_COMPANION_EXTENSION_DIR?.trim();
    for (const fileName of ['Preferences', 'Secure Preferences']) {
      const raw = await readBoundedJson(path.join(profilePath, fileName), MAX_PREFERENCES_BYTES);
      const preferences = preferencesSchema.safeParse(raw);
      if (!preferences.success) continue;
      const rawSetting = preferences.data.extensions?.settings[EXTENSION_ID];
      const setting = extensionSettingSchema.safeParse(rawSetting);
      if (!setting.success) continue;
      if (setting.data.state === 0 || (setting.data.disable_reasons?.length ?? 0) > 0) continue;
      if (
        developmentDirectory &&
        (!setting.data.path || !pathsMatch(setting.data.path, developmentDirectory, this.options.platform))
      ) {
        continue;
      }
      return true;
    }
    return false;
  }

  private async discoverProfiles(definition: BrowserDefinition): Promise<BrowserCompanionBrowser['profiles']> {
    const userDataRoot = this.userDataRoot(definition);
    if (!userDataRoot) return [];
    const state = localStateSchema.safeParse(
      await readBoundedJson(path.join(userDataRoot, 'Local State'), MAX_LOCAL_STATE_BYTES),
    );
    if (!state.success) return [];

    const profiles: BrowserCompanionBrowser['profiles'] = [];
    const entries = Object.entries(state.data.profile.info_cache).slice(0, MAX_PROFILES_PER_BROWSER);
    for (const [rawDirectory, rawInfo] of entries) {
      const directory = browserCompanionProfileSchema.shape.directory.safeParse(rawDirectory);
      const info = profileInfoSchema.safeParse(rawInfo);
      if (!directory.success || !info.success) continue;
      const profilePath = path.join(userDataRoot, directory.data);
      if (!(await existingDirectory(profilePath))) continue;
      profiles.push({
        directory: directory.data,
        name: info.data.name ?? directory.data,
        companionInstalled: await this.extensionInstalled(profilePath),
      });
    }
    return profiles;
  }

  private async discoverBrowser(definition: BrowserDefinition): Promise<BrowserCompanionBrowser> {
    const [available, profiles] = await Promise.all([
      this.executable(definition).then(Boolean),
      this.discoverProfiles(definition),
    ]);
    return { id: definition.id, name: definition.name, available, profiles };
  }

  private async configuredRoutes(): Promise<BrowserCompanionRoutes | null> {
    const rawSelection = await readBoundedJson(this.selectionPath, 16 * 1024);
    const current = selectionSchema.safeParse(rawSelection);
    if (current.success) return current.data.routes;

    const previous = previousSelectionSchema.safeParse(rawSelection);
    if (previous.success) {
      return {
        ...previous.data.routes,
        wechat: previous.data.routes.chatgpt ?? previous.data.routes.weibo,
      };
    }

    const legacy = legacySelectionSchema.safeParse(await readBoundedJson(this.legacySelectionPath, 16 * 1024));
    if (!legacy.success) return null;
    const destination = browserCompanionDestinationSchema.parse({
      browserId: 'chrome',
      profileDirectory: legacy.data.selectedProfileDirectory,
    });
    return { chatgpt: destination, wechat: destination, weibo: destination };
  }

  private inferredRoutes(browsers: readonly BrowserCompanionBrowser[]): BrowserCompanionRoutes {
    const destinations = browsers.flatMap((browser) =>
      browser.available
        ? browser.profiles
            .filter((profile) => profile.companionInstalled)
            .map((profile) => ({ browserId: browser.id, profileDirectory: profile.directory }))
        : [],
    );
    if (destinations.length !== 1) return EMPTY_ROUTES;
    return { chatgpt: destinations[0], wechat: destinations[0], weibo: destinations[0] };
  }

  async destinations(): Promise<BrowserCompanionDestinationsResult> {
    const [browsers, configuredRoutes] = await Promise.all([
      Promise.all(BROWSER_DEFINITIONS.map((definition) => this.discoverBrowser(definition))),
      this.configuredRoutes(),
    ]);
    return browserCompanionDestinationsResultSchema.parse({
      browsers,
      routes: configuredRoutes ?? this.inferredRoutes(browsers),
    });
  }

  private async persistRoutes(routes: BrowserCompanionRoutes): Promise<void> {
    const selection = selectionSchema.parse({ schemaVersion: 3, routes });
    await mkdir(path.dirname(this.selectionPath), { recursive: true });
    const bytes = Buffer.from(JSON.stringify(selection), 'utf8');
    const temporaryPath = `${this.selectionPath}.${randomUUID()}.tmp`;
    await writeFile(temporaryPath, bytes, { flag: 'wx', mode: 0o600 });
    try {
      await rename(temporaryPath, this.selectionPath);
    } catch (reason) {
      if (!hasErrorCode(reason, 'EEXIST') && !hasErrorCode(reason, 'EPERM')) throw reason;
      await writeFile(this.selectionPath, bytes, { flag: 'w', mode: 0o600 });
      await rm(temporaryPath, { force: true });
    }
  }

  async select(
    target: BrowserCompanionTarget,
    browserId: BrowserCompanionBrowserId,
    profileDirectory: string,
  ): Promise<BrowserCompanionDestinationsResult> {
    const mutation = this.selectionMutation.then(async () => {
      const validatedBrowserId = browserCompanionBrowserIdSchema.parse(browserId);
      const validatedDirectory = browserCompanionProfileSchema.shape.directory.parse(profileDirectory);
      const state = await this.destinations();
      const browser = state.browsers.find((candidate) => candidate.id === validatedBrowserId);
      if (!browser?.available) throw new BrowserCompanionLaunchError('BROWSER_NOT_FOUND', 'Browser is unavailable');
      const profile = browser.profiles.find((candidate) => candidate.directory === validatedDirectory);
      if (!profile) throw new BrowserCompanionLaunchError('PROFILE_UNAVAILABLE', 'Browser Profile is unavailable');
      if (!profile.companionInstalled) {
        throw new BrowserCompanionLaunchError(
          'COMPANION_NOT_INSTALLED',
          'AIY Companion is not installed in this Profile',
        );
      }
      await this.persistRoutes({
        ...state.routes,
        [target]: { browserId: validatedBrowserId, profileDirectory: validatedDirectory },
      });
      return this.destinations();
    });
    this.selectionMutation = mutation.then(
      () => undefined,
      () => undefined,
    );
    return mutation;
  }

  async open(target: BrowserCompanionTarget, url: string): Promise<void> {
    const state = await this.destinations();
    const destination = state.routes[target];
    if (!destination) {
      throw new BrowserCompanionLaunchError('DESTINATION_NOT_SELECTED', 'No browser destination is selected');
    }
    const definition = this.definition(destination.browserId);
    const executable = await this.executable(definition);
    if (!executable) throw new BrowserCompanionLaunchError('BROWSER_NOT_FOUND', 'Browser is unavailable');
    const browser = state.browsers.find((candidate) => candidate.id === destination.browserId);
    const profile = browser?.profiles.find((candidate) => candidate.directory === destination.profileDirectory);
    if (!profile) throw new BrowserCompanionLaunchError('PROFILE_UNAVAILABLE', 'Browser Profile is unavailable');
    if (!profile.companionInstalled) {
      throw new BrowserCompanionLaunchError(
        'COMPANION_NOT_INSTALLED',
        'AIY Companion is not installed in this Profile',
      );
    }
    let launchUrl: string;
    try {
      launchUrl = this.options.prepareLaunchUrl(target, url);
    } catch (reason) {
      throw new BrowserCompanionLaunchError(
        'DESKTOP_SERVICE_UNAVAILABLE',
        reason instanceof Error ? reason.message : String(reason),
      );
    }

    const args = [`--profile-directory=${profile.directory}`];
    const overrideRoot = this.options.environment[definition.userDataOverride]?.trim();
    if (overrideRoot) args.unshift(`--user-data-dir=${path.resolve(overrideRoot)}`);
    args.push(launchUrl);
    await new Promise<void>((resolve, reject) => {
      const child = spawn(executable, args, { detached: true, stdio: 'ignore', windowsHide: false });
      child.once('error', (reason) => reject(new BrowserCompanionLaunchError('LAUNCH_FAILED', reason.message)));
      child.once('spawn', () => {
        child.unref();
        resolve();
      });
    });
  }
}
