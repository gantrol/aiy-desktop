import {
  DEFAULT_NATURAL_WATERMARK_PROFILE,
  NATURAL_WATERMARK_PROFILE_NAME_MAX_LENGTH,
  type NaturalWatermarkConfiguration,
  type NaturalWatermarkProfile,
} from '@/shared/contracts/natural-watermark';

export function cloneNaturalWatermarkProfile(profile: NaturalWatermarkProfile): NaturalWatermarkProfile {
  return {
    ...profile,
    logo: { ...profile.logo },
    position: { ...profile.position },
    positionJitter: { ...profile.positionJitter },
  };
}

export function cloneNaturalWatermarkConfiguration(
  configuration: NaturalWatermarkConfiguration,
): NaturalWatermarkConfiguration {
  return {
    profiles: configuration.profiles.map(cloneNaturalWatermarkProfile),
    preferredProfileId: configuration.preferredProfileId,
  };
}

export function naturalWatermarkConfigurationFingerprint(configuration: NaturalWatermarkConfiguration) {
  return JSON.stringify(configuration);
}

export function uniqueNaturalWatermarkProfileName(profiles: readonly NaturalWatermarkProfile[], requested: string) {
  const base = requested.trim().slice(0, NATURAL_WATERMARK_PROFILE_NAME_MAX_LENGTH) || 'Watermark';
  const names = new Set(profiles.map(({ name }) => name.toLowerCase()));
  if (!names.has(base.toLowerCase())) return base;
  for (let sequence = 2; sequence <= profiles.length + 2; sequence += 1) {
    const suffix = ` ${sequence}`;
    const candidate = `${base.slice(0, NATURAL_WATERMARK_PROFILE_NAME_MAX_LENGTH - suffix.length)}${suffix}`;
    if (!names.has(candidate.toLowerCase())) return candidate;
  }
  throw new Error('Unable to create a unique watermark profile name');
}

export function createNaturalWatermarkProfile(
  profiles: readonly NaturalWatermarkProfile[],
  requestedName: string,
): NaturalWatermarkProfile {
  return {
    ...cloneNaturalWatermarkProfile(DEFAULT_NATURAL_WATERMARK_PROFILE),
    id: crypto.randomUUID(),
    name: uniqueNaturalWatermarkProfileName(profiles, requestedName),
  };
}

export function duplicateNaturalWatermarkProfile(
  profiles: readonly NaturalWatermarkProfile[],
  source: NaturalWatermarkProfile,
  copyLabel: string,
): NaturalWatermarkProfile {
  return {
    ...cloneNaturalWatermarkProfile(source),
    id: crypto.randomUUID(),
    name: uniqueNaturalWatermarkProfileName(profiles, `${source.name} ${copyLabel}`),
  };
}

export function clampNaturalWatermarkRatio(value: number, minimum = 0, maximum = 1) {
  return Math.min(maximum, Math.max(minimum, value));
}
