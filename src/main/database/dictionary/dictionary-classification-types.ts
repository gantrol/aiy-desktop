import type { DictionaryClassificationLocalizationDto } from '@/shared/contracts';
import type { JsonMap } from '@/main/database/core/values';

export interface ClassificationRow extends JsonMap {
  id: string;
  stable_key: string;
  parent_id: string | null;
  name: string;
  name_locale: string;
  sort_order: number;
  state: string;
  source_type: string;
  modified_locally: number;
  primary_facet_value_id: string;
  secondary_facet_value_id: string | null;
  source_patch_json?: string | null;
}

export interface ClassificationNames {
  name: string;
  nameLocale: string;
  localizations: DictionaryClassificationLocalizationDto[];
}
