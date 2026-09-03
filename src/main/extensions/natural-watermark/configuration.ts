import { z } from 'zod';
import { readBoundedJsonWithBackupSourceAsync, writeJsonAtomicallyAsync } from '@/main/app/atomic-json-file';
import {
  DEFAULT_NATURAL_WATERMARK_CONFIGURATION,
  naturalWatermarkBrandSchema,
  naturalWatermarkConfigurationSchema,
  type NaturalWatermarkConfiguration,
} from '@/shared/contracts/natural-watermark';

const MAX_CONFIGURATION_BYTES = 16 * 1024;
const legacyNaturalWatermarkConfigurationSchema = z
  .object({
    brand: naturalWatermarkBrandSchema,
    placement: naturalWatermarkConfigurationSchema.shape.placement,
    opacity: naturalWatermarkConfigurationSchema.shape.opacity,
  })
  .strict();
const persistedNaturalWatermarkConfigurationSchema = z.discriminatedUnion('schemaVersion', [
  z
    .object({
      schemaVersion: z.literal(1),
      configuration: legacyNaturalWatermarkConfigurationSchema,
      updatedAt: z.string().datetime({ offset: true }),
    })
    .strict(),
  z
    .object({
      schemaVersion: z.literal(2),
      configuration: naturalWatermarkConfigurationSchema,
      updatedAt: z.string().datetime({ offset: true }),
    })
    .strict(),
]);

function configurationFromPersisted(raw: unknown): NaturalWatermarkConfiguration {
  const persisted = persistedNaturalWatermarkConfigurationSchema.parse(raw);
  if (persisted.schemaVersion === 2) return persisted.configuration;
  return {
    logo: { kind: 'BUILT_IN', brand: persisted.configuration.brand },
    text: persisted.configuration.brand === 'AIY' ? 'AIY' : 'AICanDo.XYZ',
    placement: persisted.configuration.placement,
    opacity: persisted.configuration.opacity,
  };
}

function snapshot(configuration: NaturalWatermarkConfiguration): NaturalWatermarkConfiguration {
  return { ...configuration, logo: { ...configuration.logo } };
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

  async save(rawConfiguration: NaturalWatermarkConfiguration) {
    const configuration = naturalWatermarkConfigurationSchema.parse(rawConfiguration);
    await this.initialize();
    const mutation = this.mutations.then(async () => {
      await writeJsonAtomicallyAsync(this.filePath, {
        schemaVersion: 2,
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
