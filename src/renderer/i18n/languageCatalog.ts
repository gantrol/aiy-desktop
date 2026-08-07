import type { MessageCatalog } from '@/renderer/i18n/types';

type MessageParameter = string | number | boolean | null | undefined;

interface SerializedMessageCondition {
  param: string;
  equals?: MessageParameter;
  truthy?: boolean;
}

interface SerializedMessageVariant {
  when: SerializedMessageCondition;
  template: string;
}

interface SerializedMessageTemplate {
  $params: string[];
  $template: string;
  $variants?: SerializedMessageVariant[];
  $formats?: Record<string, { kind: 'padStart'; length: number; fill: string }>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isMessageTemplate(value: unknown): value is SerializedMessageTemplate {
  if (!isRecord(value) || !Array.isArray(value.$params) || typeof value.$template !== 'string') return false;
  if (
    value.$params.length > 20 ||
    !value.$params.every((parameter) => typeof parameter === 'string' && /^[A-Za-z][A-Za-z0-9_]*$/.test(parameter))
  )
    return false;
  if (
    value.$formats !== undefined &&
    (!isRecord(value.$formats) ||
      !Object.values(value.$formats).every(
        (format) =>
          isRecord(format) &&
          format.kind === 'padStart' &&
          typeof format.length === 'number' &&
          Number.isInteger(format.length) &&
          format.length >= 1 &&
          format.length <= 32 &&
          typeof format.fill === 'string' &&
          format.fill.length >= 1 &&
          format.fill.length <= 8,
      ))
  )
    return false;
  if (value.$variants === undefined) return true;
  return (
    Array.isArray(value.$variants) &&
    value.$variants.length <= 20 &&
    value.$variants.every(
      (variant) =>
        isRecord(variant) &&
        isRecord(variant.when) &&
        typeof variant.when.param === 'string' &&
        typeof variant.template === 'string',
    )
  );
}

function conditionMatches(
  condition: SerializedMessageCondition,
  parameters: Readonly<Record<string, MessageParameter>>,
) {
  const value = parameters[condition.param];
  if (Object.prototype.hasOwnProperty.call(condition, 'equals')) return Object.is(value, condition.equals);
  if (condition.truthy !== undefined) return Boolean(value) === condition.truthy;
  return false;
}

function renderTemplate(
  template: string,
  parameters: Readonly<Record<string, MessageParameter>>,
  formats: SerializedMessageTemplate['$formats'],
) {
  return template.replace(/\{([A-Za-z][A-Za-z0-9_]*)\}/g, (placeholder, name: string) =>
    Object.prototype.hasOwnProperty.call(parameters, name)
      ? formats?.[name]?.kind === 'padStart'
        ? String(parameters[name] ?? '').padStart(formats[name].length, formats[name].fill)
        : String(parameters[name] ?? '')
      : placeholder,
  );
}

function hydrateNode(fallback: unknown, translated: unknown): unknown {
  if (typeof fallback === 'string') return typeof translated === 'string' ? translated : fallback;
  if (typeof fallback === 'function') {
    if (!isMessageTemplate(translated)) return fallback;
    return (...args: MessageParameter[]) => {
      const parameters = Object.fromEntries(translated.$params.map((name, index) => [name, args[index]]));
      const variant = translated.$variants?.find((candidate) => conditionMatches(candidate.when, parameters));
      return renderTemplate(variant?.template ?? translated.$template, parameters, translated.$formats);
    };
  }
  if (!isRecord(fallback)) return fallback;
  const translatedRecord = isRecord(translated) ? translated : {};
  return Object.fromEntries(
    Object.entries(fallback).map(([key, value]) => [key, hydrateNode(value, translatedRecord[key])]),
  );
}

/**
 * Turn a data-only language pack into the catalog shape used by the UI.
 * Unknown and missing entries are ignored and fall back to the host's English
 * catalog, so a stale translation cannot remove executable UI behavior.
 */
export function hydrateLanguageCatalog(translated: unknown, fallback: MessageCatalog): MessageCatalog {
  return hydrateNode(fallback, translated) as MessageCatalog;
}
