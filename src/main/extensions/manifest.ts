import { z } from 'zod';
import type { ExtensionManifestDto } from '@/shared/contracts';
import { EXTENSION_HOST_ENGINE_KEY } from '@/shared/product';

const identifier = z
  .string()
  .trim()
  .min(3)
  .max(160)
  .regex(/^[a-z0-9][a-z0-9._-]*$/);
const configurationKey = z
  .string()
  .trim()
  .min(1)
  .max(160)
  .regex(/^[A-Za-z][A-Za-z0-9._-]*$/);
const contributionIdentifier = z
  .string()
  .trim()
  .min(3)
  .max(160)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/);
const permissionKey = z
  .string()
  .trim()
  .min(3)
  .max(240)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/);
const contributionIds = z.array(contributionIdentifier).max(200);
const htmlLanguage = z
  .string()
  .trim()
  .min(2)
  .max(35)
  .regex(/^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/);
const localizedFieldSchema = z
  .object({
    label: z.string().trim().min(1).max(120),
    placeholder: z.string().trim().max(240),
  })
  .strict();
const configurationLocalizationSchema = z
  .object({
    title: z.string().trim().min(1).max(120),
    apiKeyLabel: z.string().trim().min(1).max(120),
    apiKeyPlaceholder: z.string().trim().max(240),
    endpointLabel: z.string().trim().min(1).max(120),
    endpointOptions: z.record(identifier, z.string().trim().min(1).max(160)),
    customEndpointLabel: z.string().trim().min(1).max(120),
    customEndpointPlaceholder: z.string().trim().max(500),
    modelIdLabel: z.string().trim().min(1).max(120),
    modelIdPlaceholder: z.string().trim().max(240),
    fields: z.record(configurationKey, localizedFieldSchema),
  })
  .strict();
const extensionLocalizationSchema = z
  .object({
    displayName: z.string().trim().min(1).max(120),
    description: z.string().trim().max(500),
    configuration: configurationLocalizationSchema.optional(),
  })
  .strict();
const imageApiConfigurationSchema = z
  .object({
    kind: z.literal('IMAGE_API'),
    defaultEndpointPresetId: identifier,
    endpointPresets: z
      .array(
        z
          .object({
            id: identifier,
            endpointTemplate: z.string().trim().min(8).max(500),
            modelId: z
              .string()
              .trim()
              .min(1)
              .max(200)
              .regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/),
          })
          .strict(),
      )
      .min(1)
      .max(30),
    settingFields: z
      .array(
        z
          .object({
            key: configurationKey,
            required: z.boolean(),
            endpointPresetIds: z.array(identifier).min(1).max(30),
          })
          .strict(),
      )
      .max(30),
    customEndpointAllowed: z.boolean(),
    customModelIdAllowed: z.boolean(),
    connectionCheckPresetIds: z.array(identifier).max(30),
  })
  .strict();

const manifestSchema = z
  .object({
    // Protocol version for the manifest JSON shape. Extension releases use
    // `version`; changing code, copy, or contributions does not advance this.
    manifestVersion: z.literal(1),
    kind: z.enum(['CAPABILITY', 'LANGUAGE']),
    category: z.enum(['FRONTEND_DESIGN']).optional(),
    id: identifier,
    version: z
      .string()
      .trim()
      .regex(/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/),
    displayName: z.string().trim().min(1).max(120),
    description: z.string().trim().max(500),
    engines: z
      .object({
        [EXTENSION_HOST_ENGINE_KEY]: z.string().trim().min(1).max(80),
      })
      .strict(),
    contributes: z
      .object({
        themes: contributionIds.optional(),
        fields: contributionIds.optional(),
        filters: contributionIds.optional(),
        commands: contributionIds.optional(),
        workflows: contributionIds.optional(),
        tools: contributionIds.optional(),
        searchProviders: contributionIds.optional(),
        modelProviders: contributionIds.optional(),
      })
      .strict(),
    permissions: z.array(permissionKey).max(80),
    optionalPermissions: z.array(permissionKey).max(80),
    i18n: z
      .object({
        defaultLocale: z.enum(['zh', 'en']),
        locales: z
          .object({
            zh: extensionLocalizationSchema.optional(),
            en: extensionLocalizationSchema.optional(),
          })
          .strict(),
      })
      .strict()
      .optional(),
    language: z
      .object({
        locale: z.enum(['zh', 'en']),
        htmlLanguage,
        catalog: z.literal('messages.json').optional(),
      })
      .strict()
      .optional(),
    runtime: z
      .object({
        kind: z.literal('HOST'),
        id: identifier,
      })
      .strict()
      .optional(),
    configuration: imageApiConfigurationSchema.optional(),
  })
  .strict();

export function parseExtensionManifest(value: unknown): ExtensionManifestDto {
  const manifest = manifestSchema.parse(value) as ExtensionManifestDto;
  const required = new Set(manifest.permissions);
  if (manifest.optionalPermissions.some((permission) => required.has(permission))) {
    throw new Error(`Extension ${manifest.id} declares a permission as both required and optional`);
  }
  if (manifest.i18n && !manifest.i18n.locales[manifest.i18n.defaultLocale]) {
    throw new Error(`Extension ${manifest.id} is missing its default locale`);
  }
  if (manifest.kind === 'LANGUAGE' && !manifest.language) {
    throw new Error(`Language extension ${manifest.id} is missing its language declaration`);
  }
  if (manifest.kind !== 'LANGUAGE' && manifest.language) {
    throw new Error(`Capability extension ${manifest.id} cannot declare a language`);
  }
  if (manifest.kind === 'LANGUAGE' && manifest.runtime) {
    throw new Error(`Language extension ${manifest.id} cannot declare a runtime`);
  }
  if (manifest.configuration) validateImageApiConfiguration(manifest);
  return manifest;
}

function validateImageApiConfiguration(manifest: ExtensionManifestDto) {
  const configuration = manifest.configuration!;
  const presetIds = new Set(configuration.endpointPresets.map((preset) => preset.id));
  if (presetIds.size !== configuration.endpointPresets.length) {
    throw new Error(`Extension ${manifest.id} declares duplicate endpoint presets`);
  }
  if (!presetIds.has(configuration.defaultEndpointPresetId)) {
    throw new Error(`Extension ${manifest.id} has an unknown default endpoint preset`);
  }
  const settingKeys = new Set(configuration.settingFields.map((field) => field.key));
  if (settingKeys.size !== configuration.settingFields.length) {
    throw new Error(`Extension ${manifest.id} declares duplicate configuration fields`);
  }
  for (const field of configuration.settingFields) {
    if (field.endpointPresetIds.some((presetId) => !presetIds.has(presetId))) {
      throw new Error(`Extension ${manifest.id} configuration field references an unknown endpoint preset`);
    }
  }
  if (configuration.connectionCheckPresetIds.some((presetId) => !presetIds.has(presetId))) {
    throw new Error(`Extension ${manifest.id} connection check references an unknown endpoint preset`);
  }
  for (const preset of configuration.endpointPresets) {
    const placeholders = [...preset.endpointTemplate.matchAll(/\{([A-Za-z0-9._-]+)\}/g)].map((match) => match[1]);
    if (placeholders.some((key) => !settingKeys.has(key))) {
      throw new Error(`Extension ${manifest.id} endpoint template references an undeclared setting`);
    }
    let endpoint: URL;
    try {
      endpoint = new URL(preset.endpointTemplate.replace(/\{[A-Za-z0-9._-]+\}/g, 'placeholder'));
    } catch {
      throw new Error(`Extension ${manifest.id} declares an invalid endpoint template`);
    }
    if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
      throw new Error(`Extension ${manifest.id} endpoint templates must be credential-free HTTPS URLs`);
    }
  }
  for (const localization of Object.values(manifest.i18n?.locales ?? {})) {
    if (!localization?.configuration) continue;
    const options = localization.configuration.endpointOptions;
    if (configuration.endpointPresets.some((preset) => !options[preset.id])) {
      throw new Error(`Extension ${manifest.id} locale is missing an endpoint option`);
    }
    if (configuration.customEndpointAllowed && !options.custom) {
      throw new Error(`Extension ${manifest.id} locale is missing the custom endpoint option`);
    }
    if (configuration.settingFields.some((field) => !localization.configuration?.fields[field.key])) {
      throw new Error(`Extension ${manifest.id} locale is missing a configuration field`);
    }
  }
}

function parseVersion(version: string) {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version);
  return match ? (match.slice(1).map(Number) as [number, number, number]) : null;
}

function compareVersion(left: [number, number, number], right: [number, number, number]) {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
}

/** Small fail-closed range evaluator for the manifest formats currently emitted by the host. */
export function extensionSupportsHost(range: string, hostVersion: string) {
  const host = parseVersion(hostVersion);
  if (!host) return false;
  const normalized = range.trim();
  if (normalized === '*') return true;
  if (normalized.startsWith('^')) {
    const minimum = parseVersion(normalized.slice(1));
    if (!minimum || compareVersion(host, minimum) < 0) return false;
    const upper: [number, number, number] =
      minimum[0] > 0 ? [minimum[0] + 1, 0, 0] : minimum[1] > 0 ? [0, minimum[1] + 1, 0] : [0, 0, minimum[2] + 1];
    return compareVersion(host, upper) < 0;
  }
  const exact = parseVersion(normalized);
  return exact ? compareVersion(host, exact) === 0 : false;
}
