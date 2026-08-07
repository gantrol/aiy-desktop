import type { enMessages } from '@/renderer/i18n/locales/en';

type WidenCatalog<Value> = Value extends (...args: infer Args) => unknown
  ? (...args: Args) => string
  : Value extends readonly (infer Item)[]
    ? Array<WidenCatalog<Item>>
    : Value extends object
      ? { [Key in keyof Value]: WidenCatalog<Value[Key]> }
      : Value extends string
        ? string
        : Value;

export type MessageCatalog = WidenCatalog<typeof enMessages>;
export type DictionaryMessages = MessageCatalog['dictionary']['editor'];
export type RecipeItemMessages = MessageCatalog['recipe']['item'];
