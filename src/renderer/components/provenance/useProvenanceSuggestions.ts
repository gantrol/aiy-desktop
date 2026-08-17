import { useCallback, useEffect, useMemo, useState } from 'react';
import type { MaterialProvenanceSuggestionsDto } from '@/shared/contracts';
import {
  findProvenanceModelFamily,
  findProvenanceSourceService,
  isDeprecatedGenericProvenanceSourceName,
  PROVENANCE_MODEL_FAMILIES,
  PROVENANCE_SOURCE_SERVICES,
  type ProvenanceModelGroup,
  type ProvenanceSourceGroup,
} from '@/shared/provenance-catalog';
import type { ComboboxInputSuggestion } from '@/renderer/components/ui/combobox-input';
import { useI18n } from '@/renderer/i18n/useI18n';

interface ProvenanceMenuSuggestion extends ComboboxInputSuggestion {
  catalogId: string | null;
}

const emptySuggestions: MaterialProvenanceSuggestionsDto = {
  modelFamilyIds: [],
  customModelNames: [],
  sourceServiceIds: [],
  customSourceNames: [],
};
const modelGroupOrder: Readonly<Record<ProvenanceModelGroup, number>> = { OPENAI: 0, GOOGLE: 1, OTHER: 2 };
const sourceGroupOrder: Readonly<Record<ProvenanceSourceGroup, number>> = {
  PRODUCT: 0,
  OFFICIAL_API: 1,
  GATEWAY: 2,
  LOCAL: 3,
};

function uniqueSuggestions(values: readonly string[]) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const rawValue of values) {
    const value = rawValue.trim();
    const key = value.toLocaleLowerCase();
    if (!value || seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result;
}

function mergeSuggestions(
  current: MaterialProvenanceSuggestionsDto,
  incoming: MaterialProvenanceSuggestionsDto,
): MaterialProvenanceSuggestionsDto {
  return {
    modelFamilyIds: uniqueSuggestions([...current.modelFamilyIds, ...incoming.modelFamilyIds]),
    customModelNames: uniqueSuggestions([...current.customModelNames, ...incoming.customModelNames]),
    sourceServiceIds: uniqueSuggestions([...current.sourceServiceIds, ...incoming.sourceServiceIds]),
    customSourceNames: uniqueSuggestions([...current.customSourceNames, ...incoming.customSourceNames]),
  };
}

/**
 * Builds independent model-family and source-service menus. Execution routes,
 * adapters, credentials, and provider display labels never enter either list.
 * Values remain editable free text because imported provenance can predate the
 * catalog or come from a service the app does not know yet.
 */
export function useProvenanceSuggestions(enabled = true) {
  const labels = useI18n().messages.creator.generationRecord;
  const [known, setKnown] = useState<MaterialProvenanceSuggestionsDto>(emptySuggestions);

  useEffect(() => {
    if (!enabled) return undefined;
    let current = true;
    void window.desktopApi
      .materialProvenanceSuggestions()
      .then((result) => {
        if (current) setKnown((values) => mergeSuggestions(values, result));
      })
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [enabled]);

  const modelGroupLabels = useMemo<Record<ProvenanceModelGroup, string>>(
    () => ({
      OPENAI: labels.modelGroupOpenAi,
      GOOGLE: labels.modelGroupGoogle,
      OTHER: labels.modelGroupOther,
    }),
    [labels.modelGroupGoogle, labels.modelGroupOpenAi, labels.modelGroupOther],
  );
  const sourceGroupLabels = useMemo<Record<ProvenanceSourceGroup, string>>(
    () => ({
      PRODUCT: labels.sourceGroupProducts,
      OFFICIAL_API: labels.sourceGroupOfficialApis,
      GATEWAY: labels.sourceGroupGateways,
      LOCAL: labels.sourceGroupLocal,
    }),
    [labels.sourceGroupGateways, labels.sourceGroupLocal, labels.sourceGroupOfficialApis, labels.sourceGroupProducts],
  );

  const modelSuggestions = useMemo<ProvenanceMenuSuggestion[]>(() => {
    const knownIds = new Set(known.modelFamilyIds);
    const catalog = [...PROVENANCE_MODEL_FAMILIES]
      .sort(
        (left, right) =>
          modelGroupOrder[left.group] - modelGroupOrder[right.group] ||
          Number(knownIds.has(right.id)) - Number(knownIds.has(left.id)),
      )
      .map((model) => ({
        value: model.name,
        group: modelGroupLabels[model.group],
        keywords: [model.id, ...model.aliases],
        catalogId: model.id,
      }));
    const custom = known.customModelNames.map((value) => ({
      value,
      group: labels.modelGroupHistory,
      catalogId: null,
    }));
    return [...catalog, ...custom];
  }, [known.customModelNames, known.modelFamilyIds, labels.modelGroupHistory, modelGroupLabels]);

  const sourceSuggestions = useMemo<ProvenanceMenuSuggestion[]>(() => {
    const knownIds = new Set(known.sourceServiceIds);
    const catalog = [...PROVENANCE_SOURCE_SERVICES]
      .sort(
        (left, right) =>
          sourceGroupOrder[left.group] - sourceGroupOrder[right.group] ||
          Number(knownIds.has(right.id)) - Number(knownIds.has(left.id)),
      )
      .map((source) => ({
        value: source.name,
        group: sourceGroupLabels[source.group],
        keywords: [source.id, ...source.aliases, ...source.surfaces],
        catalogId: source.id,
      }));
    const custom = known.customSourceNames.map((value) => ({
      value,
      group: labels.sourceGroupHistory,
      catalogId: null,
    }));
    return [...catalog, ...custom];
  }, [known.customSourceNames, known.sourceServiceIds, labels.sourceGroupHistory, sourceGroupLabels]);

  const modelsForSource = useCallback(
    (sourceValue: string): readonly ComboboxInputSuggestion[] => {
      const source = findProvenanceSourceService(sourceValue);
      if (!source?.modelFamilyIds) return modelSuggestions;
      const compatibleIds = new Set(source.modelFamilyIds);
      return modelSuggestions.filter(
        (suggestion) => suggestion.catalogId === null || compatibleIds.has(suggestion.catalogId),
      );
    },
    [modelSuggestions],
  );

  const sourcesForModel = useCallback(
    (modelValue: string): readonly ComboboxInputSuggestion[] => {
      const model = findProvenanceModelFamily(modelValue);
      if (!model) return sourceSuggestions;
      const hasSpecificSourceCoverage = PROVENANCE_SOURCE_SERVICES.some((source) => {
        if (!('modelFamilyIds' in source)) return false;
        const compatibleIds: readonly string[] = source.modelFamilyIds;
        return compatibleIds.includes(model.id);
      });
      if (!hasSpecificSourceCoverage) return sourceSuggestions;
      return sourceSuggestions.filter((suggestion) => {
        if (suggestion.catalogId === null) return true;
        const source = findProvenanceSourceService(suggestion.catalogId);
        return !source?.modelFamilyIds || source.modelFamilyIds.includes(model.id);
      });
    },
    [sourceSuggestions],
  );

  const remember = useCallback((modelName: string, sourceName: string) => {
    const model = findProvenanceModelFamily(modelName);
    const source = findProvenanceSourceService(sourceName);
    setKnown((current) =>
      mergeSuggestions(current, {
        modelFamilyIds: model ? [model.id] : [],
        customModelNames: modelName.trim() && !model && !findProvenanceSourceService(modelName) ? [modelName] : [],
        sourceServiceIds: source ? [source.id] : [],
        customSourceNames:
          sourceName.trim() &&
          !source &&
          !findProvenanceModelFamily(sourceName) &&
          !isDeprecatedGenericProvenanceSourceName(sourceName)
            ? [sourceName]
            : [],
      }),
    );
  }, []);

  return { modelsForSource, sourcesForModel, remember };
}
