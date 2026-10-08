import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const defaultPath = fileURLToPath(new URL('../src/shared/codex-usage-rate-card.json', import.meta.url));
const identifierPattern = /^[a-z0-9]+(?:[.:-][a-z0-9]+)*$/;
const reserved = new Set(['__proto__', 'constructor', 'prototype']);

function requireValue(condition, message) {
  if (!condition) throw new Error(message);
}

function object(value, label, keys) {
  requireValue(value !== null && typeof value === 'object' && !Array.isArray(value), `${label}: expected object`);
  requireValue(
    Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key)),
    `${label}: missing or unexpected fields`,
  );
}

function date(value, label) {
  requireValue(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value), `${label}: expected YYYY-MM-DD`);
  const epoch = Date.parse(`${value}T00:00:00Z`);
  requireValue(
    Number.isFinite(epoch) && new Date(epoch).toISOString().slice(0, 10) === value,
    `${label}: invalid date`,
  );
}

function rate(value, label, nullable = false) {
  if (nullable && value === null) return;
  requireValue(typeof value === 'number' && Number.isFinite(value) && value >= 0, `${label}: invalid rate`);
}

function source(value, label) {
  requireValue(typeof value === 'string', `${label}: expected URL`);
  const url = new URL(value);
  requireValue(url.protocol === 'https:' && !url.username && !url.password, `${label}: expected HTTPS source`);
}

function periods(values, label, kind) {
  requireValue(Array.isArray(values), `${label}: expected periods array`);
  let previous = null;
  for (const [index, value] of values.entries()) {
    const name = `${label}[${index}]`;
    const api = kind === 'api';
    object(
      value,
      name,
      api
        ? [
            'effectiveFrom',
            'inputPerMillionUsd',
            'cachedInputPerMillionUsd',
            'cacheWriteInputPerMillionUsd',
            'outputPerMillionUsd',
            'longContext',
            ...(Object.hasOwn(value, 'maxInputTokens') ? ['maxInputTokens'] : []),
          ]
        : ['effectiveFrom', 'inputPerMillion', 'cachedInputPerMillion', 'outputPerMillion'],
    );
    if (value.effectiveFrom === null) requireValue(index === 0, `${name}: null baseline must be first`);
    else {
      date(value.effectiveFrom, `${name}.effectiveFrom`);
      requireValue(previous === null || value.effectiveFrom > previous, `${name}: dates must increase strictly`);
      previous = value.effectiveFrom;
    }
    if (api) {
      rate(value.inputPerMillionUsd, `${name}.inputPerMillionUsd`);
      rate(value.cachedInputPerMillionUsd, `${name}.cachedInputPerMillionUsd`, true);
      rate(value.cacheWriteInputPerMillionUsd, `${name}.cacheWriteInputPerMillionUsd`, true);
      rate(value.outputPerMillionUsd, `${name}.outputPerMillionUsd`);
      requireValue(typeof value.longContext === 'boolean', `${name}.longContext: expected boolean`);
      if (Object.hasOwn(value, 'maxInputTokens')) {
        requireValue(
          Number.isSafeInteger(value.maxInputTokens) && value.maxInputTokens > 0,
          `${name}.maxInputTokens: invalid input limit`,
        );
      }
    } else {
      rate(value.inputPerMillion, `${name}.inputPerMillion`);
      rate(value.cachedInputPerMillion, `${name}.cachedInputPerMillion`);
      rate(value.outputPerMillion, `${name}.outputPerMillion`);
    }
  }
}

export function validateCodexUsageRateCard(card) {
  object(card, 'catalog', [
    'schemaVersion',
    'updatedAt',
    ...(Object.hasOwn(card, 'creditUpdatedAt') ? ['creditUpdatedAt'] : []),
    'apiSourceUrl',
    'creditSourceUrl',
    'longContextThresholdTokens',
    'models',
  ]);
  requireValue(card.schemaVersion === 1, 'catalog: unsupported schemaVersion');
  date(card.updatedAt, 'catalog.updatedAt');
  if (Object.hasOwn(card, 'creditUpdatedAt')) {
    date(card.creditUpdatedAt, 'catalog.creditUpdatedAt');
    requireValue(card.creditUpdatedAt <= card.updatedAt, 'catalog: credit verification is newer than catalog');
  }
  source(card.apiSourceUrl, 'catalog.apiSourceUrl');
  source(card.creditSourceUrl, 'catalog.creditSourceUrl');
  requireValue(
    Number.isSafeInteger(card.longContextThresholdTokens) && card.longContextThresholdTokens > 0,
    'catalog: invalid context threshold',
  );
  requireValue(
    card.models !== null && typeof card.models === 'object' && !Array.isArray(card.models),
    'catalog.models: expected object',
  );
  const entries = Object.entries(card.models);
  requireValue(entries.length > 0 && entries.length <= 1000, 'catalog.models: invalid model count');
  const identifiers = new Set(entries.map(([key]) => key));
  for (const [key, model] of entries) {
    requireValue(identifierPattern.test(key) && !reserved.has(key), `${key}: invalid model ID`);
    object(model, key, [
      'aliases',
      'verifiedAt',
      'sourceUrls',
      'api',
      ...(Object.hasOwn(model, 'apiFast') ? ['apiFast'] : []),
      'credits',
      'fastCreditMultiplier',
      ...(Object.hasOwn(model, 'fastIncludedUsageMultiplier') ? ['fastIncludedUsageMultiplier'] : []),
    ]);
    date(model.verifiedAt, `${key}.verifiedAt`);
    requireValue(model.verifiedAt <= card.updatedAt, `${key}: verification is newer than catalog`);
    requireValue(Array.isArray(model.sourceUrls) && model.sourceUrls.length > 0, `${key}: missing sources`);
    model.sourceUrls.forEach((url) => source(url, `${key}.sourceUrls`));
    requireValue(Array.isArray(model.aliases), `${key}: expected aliases array`);
    for (const alias of model.aliases) {
      requireValue(
        typeof alias === 'string' && identifierPattern.test(alias) && !reserved.has(alias),
        `${key}: invalid alias`,
      );
      requireValue(!identifiers.has(alias), `${key}: alias collision: ${alias}`);
      identifiers.add(alias);
    }
    periods(model.api, `${key}.api`, 'api');
    if (Object.hasOwn(model, 'apiFast')) periods(model.apiFast, `${key}.apiFast`, 'api');
    periods(model.credits, `${key}.credits`, 'credits');
    requireValue(model.api.length + model.credits.length > 0, `${key}: no rates`);
    rate(model.fastCreditMultiplier, `${key}.fastCreditMultiplier`, true);
    requireValue(model.fastCreditMultiplier === null || model.fastCreditMultiplier > 0, `${key}: invalid Fast factor`);
    if (Object.hasOwn(model, 'fastIncludedUsageMultiplier')) {
      rate(model.fastIncludedUsageMultiplier, `${key}.fastIncludedUsageMultiplier`, true);
      requireValue(
        model.fastIncludedUsageMultiplier === null || model.fastIncludedUsageMultiplier > 0,
        `${key}: invalid Fast included usage factor`,
      );
    }
  }
  return card;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    requireValue(process.argv.length <= 3, 'usage: node scripts/verify-codex-usage-pricing.mjs [catalog.json]');
    const input = process.argv[2] ? resolve(process.argv[2]) : defaultPath;
    const stat = statSync(input);
    requireValue(stat.isFile() && stat.size <= 1024 * 1024, 'catalog must be a file no larger than 1 MiB');
    const card = validateCodexUsageRateCard(JSON.parse(readFileSync(input, 'utf8')));
    console.log(`Codex pricing catalog valid: ${Object.keys(card.models).length} models; revision ${card.updatedAt}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
