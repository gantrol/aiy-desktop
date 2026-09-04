import { z } from 'zod';
import { readBoundedJsonWithBackupSourceAsync, writeJsonAtomicallyAsync } from '@/main/app/atomic-json-file';
import {
  DEFAULT_NATURAL_WATERMARK_CONFIGURATION,
  DEFAULT_NATURAL_WATERMARK_PROFILE,
  DEFAULT_NATURAL_WATERMARK_PROFILE_ID,
  naturalWatermarkBrandSchema,
  naturalWatermarkConfigurationSchema,
  naturalWatermarkLogoSchema,
  naturalWatermarkPlacementSchema,
  naturalWatermarkTextSchema,
  type NaturalWatermarkConfiguration,
  type NaturalWatermarkLogo,
  type NaturalWatermarkPlacement,
  type NaturalWatermarkProfile,
} from '@/shared/contracts/natural-watermark';

const MAX_CONFIGURATION_BYTES = 96 * 1024;
const legacyBrandConfigurationSchema = z
  .object({
    brand: naturalWatermarkBrandSchema,
    placement: naturalWatermarkPlacementSchema,
    opacity: z.number().min(0.35).max(0.95),
  })
  .strict();
const legacyLogoConfigurationSchema = z
  .object({
    logo: naturalWatermarkLogoSchema,
    text: naturalWatermarkTextSchema,
    placement: naturalWatermarkPlacementSchema,
    opacity: z.number().min(0.35).max(0.95),
  })
  .strict();
const persistedNaturalWatermarkConfigurationSchema = z.discriminatedUnion('schemaVersion', [
  z
    .object({
      schemaVersion: z.literal(1),
      configuration: legacyBrandConfigurationSchema,
      updatedAt: z.string().datetime({ offset: true }),
    })
    .strict(),
  z
    .object({
      schemaVersion: z.literal(2),
      configuration: legacyLogoConfigurationSchema,
      updatedAt: z.string().datetime({ offset: true }),
    })
    .strict(),
  z
    .object({
      schemaVersion: z.literal(3),
      configuration: naturalWatermarkConfigurationSchema,
      updatedAt: z.string().datetime({ offset: true }),
    })
    .strict(),
]);

function presetText(logo: NaturalWatermarkLogo) {
  if (logo.kind === 'CUSTOM') return '';
  return logo.brand === 'AIY' ? 'AIY' : 'AICanDo.XYZ';
}

function normalizedPosition(placement: NaturalWatermarkPlacement) {
  return {
    x: placement === 'TOP_RIGHT' || placement === 'BOTTOM_RIGHT' ? 1 : 0,
    y: placement === 'BOTTOM_LEFT' || placement === 'BOTTOM_RIGHT' ? 1 : 0,
  };
}

function migratedProfile(
  configuration: z.infer<typeof legacyBrandConfigurationSchema> | z.infer<typeof legacyLogoConfigurationSchema>,
): NaturalWatermarkProfile {
  const logo: NaturalWatermarkLogo =
    'logo' in configuration ? configuration.logo : { kind: 'BUILT_IN', brand: configuration.brand };
  const text = 'text' in configuration ? configuration.text : presetText(logo);
  return {
    ...profileSnapshot(DEFAULT_NATURAL_WATERMARK_PROFILE),
    id: DEFAULT_NATURAL_WATERMARK_PROFILE_ID,
    name: logo.kind === 'BUILT_IN' ? presetText(logo) : text.trim() || 'Watermark',
    logo: { ...logo },
    text,
    position: normalizedPosition(configuration.placement),
    opacity: configuration.opacity,
  };
}

function configurationFromPersisted(raw: unknown): NaturalWatermarkConfiguration {
  const persisted = persistedNaturalWatermarkConfigurationSchema.parse(raw);
  if (persisted.schemaVersion === 3) return persisted.configuration;
  return {
    profiles: [migratedProfile(persisted.configuration)],
    preferredProfileId: DEFAULT_NATURAL_WATERMARK_PROFILE_ID,
  };
}

function profileSnapshot(profile: NaturalWatermarkProfile): NaturalWatermarkProfile {
  return {
    ...profile,
    logo: { ...profile.logo },
    position: { ...profile.position },
    positionJitter: { ...profile.positionJitter },
  };
}

function snapshot(configuration: NaturalWatermarkConfiguration): NaturalWatermarkConfiguration {
  return {
    profiles: configuration.profiles.map(profileSnapshot),
    preferredProfileId: configuration.preferredProfileId,
  };
}

export class NaturalWatermarkConfigurationStore {
  private configuration: NaturalWatermarkConfiguration = snapshot(DEFAULT_NATURAL_WATERMARK_CONFIGURATION);
  private initialization: Promise<void> | null = null;
  private mutations: Promise<void> = Promise.resolve();

  constructor(private readonly filePath: string) {}

  private initialize() {
    if (this.initialization) return this.initialization;
    this.initialization = readBoundedJsonWithBackupSourceAsync(
      this.filePath,
      MAX_CONFIGURATION_BYTES,
      (value) => persistedNaturalWatermarkConfigurationSchema.safeParse(value).success,
    ).then((stored) => {
      if (!stored) return;
      this.configuration = snapshot(configurationFromPersisted(stored.value));
    });
    return this.initialization;
  }

  async get() {
    await this.initialize();
    await this.mutations;
    return snapshot(this.configuration);
  }

  async preferredProfile() {
    const configuration = await this.get();
    const profile = configuration.profiles.find(({ id }) => id === configuration.preferredProfileId);
    if (!profile) throw new Error('Preferred watermark profile is missing');
    return profileSnapshot(profile);
  }

  async profile(profileId: string) {
    const configuration = await this.get();
    const profile = configuration.profiles.find(({ id }) => id === profileId);
    if (!profile) throw new Error('Watermark profile is unavailable');
    return profileSnapshot(profile);
  }

  async save(rawConfiguration: NaturalWatermarkConfiguration) {
    const configuration = naturalWatermarkConfigurationSchema.parse(rawConfiguration);
    await this.initialize();
    const mutation = this.mutations.then(async () => {
      await writeJsonAtomicallyAsync(this.filePath, {
        schemaVersion: 3,
        configuration,
        updatedAt: new Date().toISOString(),
      });
      this.configuration = snapshot(configuration);
    });
    this.mutations = mutation.catch(() => undefined);
    await mutation;
    return snapshot(this.configuration);
  }
}
