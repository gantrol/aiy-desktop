import { z } from 'zod';

const idSchema = z.string().min(1).max(200);
const dateTimeSchema = z.string().datetime({ offset: true });
const sortOrderSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const anchorKeySchema = z.string().trim().min(1).max(1_000);

export const creationItemPhaseSchema = z.enum(['DRAFT', 'ACTIVE']);
export const creationItemLifecycleSchema = z.enum(['ACTIVE', 'ARCHIVED']);

export const creationFormRoleSchema = z.enum([
  'ANIMATION',
  'INSPIRATION',
  'IMAGE_BREAKDOWN',
  'IMAGE_CREATION',
  'SOCIAL_POST',
  'ARTICLE',
  'VIDEO_DOCUMENT',
  'EVALUATION_SUITE',
  'SOCIAL_POST_COVER',
  'ARTICLE_HEADER',
  'ARTICLE_INLINE',
]);

export const creationPrimaryFormRoleSchema = z.enum([
  'ANIMATION',
  'IMAGE_BREAKDOWN',
  'IMAGE_CREATION',
  'SOCIAL_POST',
  'ARTICLE',
  'VIDEO_DOCUMENT',
  'EVALUATION_SUITE',
]);

export const creationSingletonFormRoleSchema = z.enum([
  'INSPIRATION',
  'IMAGE_BREAKDOWN',
  'IMAGE_CREATION',
  'VIDEO_DOCUMENT',
  'EVALUATION_SUITE',
]);

export const creationFormEntityKindSchema = z.enum([
  'GIF_DOCUMENT',
  'PROMPT_SERIES',
  'IMAGE_BREAKDOWN',
  'INSPIRATION_STASH',
  'SOCIAL_POST',
  'ARTICLE',
  'VIDEO_DOCUMENT',
  'EVALUATION_SUITE',
  'DERIVED_VISUAL',
]);

const creationFormEntityRefVariants = [
  z.object({ kind: z.literal('GIF_DOCUMENT'), id: idSchema }).strict(),
  z.object({ kind: z.literal('PROMPT_SERIES'), id: idSchema }).strict(),
  z.object({ kind: z.literal('IMAGE_BREAKDOWN'), id: idSchema }).strict(),
  z.object({ kind: z.literal('INSPIRATION_STASH'), id: idSchema }).strict(),
  z.object({ kind: z.literal('SOCIAL_POST'), id: idSchema }).strict(),
  z.object({ kind: z.literal('ARTICLE'), id: idSchema }).strict(),
  z.object({ kind: z.literal('VIDEO_DOCUMENT'), id: idSchema }).strict(),
  z.object({ kind: z.literal('EVALUATION_SUITE'), id: idSchema }).strict(),
  z.object({ kind: z.literal('DERIVED_VISUAL'), id: idSchema }).strict(),
] as const;

/** Typed domain-entity reference. Database rows flatten this into entity_type/entity_id columns. */
export const creationFormEntityRefSchema = z.discriminatedUnion('kind', creationFormEntityRefVariants);

const creationFormRecordShape = {
  id: idSchema,
  creationItemId: idSchema,
  /** Optional immutable lineage edge to another form in the same creation item. */
  sourceFormId: idSchema.nullable(),
  sortOrder: sortOrderSchema,
  createdAt: dateTimeSchema,
  updatedAt: dateTimeSchema,
};

export const inspirationCreationFormSchema = z
  .object({
    ...creationFormRecordShape,
    role: z.literal('INSPIRATION'),
    entity: z.object({ kind: z.literal('INSPIRATION_STASH'), id: idSchema }).strict(),
    anchorKey: z.null(),
  })
  .strict();

export const imageCreationFormSchema = z
  .object({
    ...creationFormRecordShape,
    role: z.literal('IMAGE_CREATION'),
    entity: z.object({ kind: z.literal('PROMPT_SERIES'), id: idSchema }).strict(),
    anchorKey: z.null(),
  })
  .strict();

export const imageBreakdownCreationFormSchema = z
  .object({
    ...creationFormRecordShape,
    role: z.literal('IMAGE_BREAKDOWN'),
    entity: z.object({ kind: z.literal('IMAGE_BREAKDOWN'), id: idSchema }).strict(),
    anchorKey: z.null(),
  })
  .strict();

export const socialPostCreationFormSchema = z
  .object({
    ...creationFormRecordShape,
    role: z.literal('SOCIAL_POST'),
    entity: z.object({ kind: z.literal('SOCIAL_POST'), id: idSchema }).strict(),
    anchorKey: z.null(),
  })
  .strict();

export const articleCreationFormSchema = z
  .object({
    ...creationFormRecordShape,
    role: z.literal('ARTICLE'),
    entity: z.object({ kind: z.literal('ARTICLE'), id: idSchema }).strict(),
    anchorKey: z.null(),
  })
  .strict();

export const videoDocumentCreationFormSchema = z
  .object({
    ...creationFormRecordShape,
    role: z.literal('VIDEO_DOCUMENT'),
    entity: z.object({ kind: z.literal('VIDEO_DOCUMENT'), id: idSchema }).strict(),
    anchorKey: z.null(),
  })
  .strict();

export const evaluationSuiteCreationFormSchema = z
  .object({
    ...creationFormRecordShape,
    role: z.literal('EVALUATION_SUITE'),
    entity: z.object({ kind: z.literal('EVALUATION_SUITE'), id: idSchema }).strict(),
    anchorKey: z.null(),
  })
  .strict();

export const socialPostCoverCreationFormSchema = z
  .object({
    ...creationFormRecordShape,
    role: z.literal('SOCIAL_POST_COVER'),
    entity: z.object({ kind: z.literal('DERIVED_VISUAL'), id: idSchema }).strict(),
    anchorKey: z.null(),
  })
  .strict();

export const articleHeaderCreationFormSchema = z
  .object({
    ...creationFormRecordShape,
    role: z.literal('ARTICLE_HEADER'),
    entity: z.object({ kind: z.literal('DERIVED_VISUAL'), id: idSchema }).strict(),
    anchorKey: z.null(),
  })
  .strict();

export const articleInlineCreationFormSchema = z
  .object({
    ...creationFormRecordShape,
    role: z.literal('ARTICLE_INLINE'),
    entity: z.object({ kind: z.literal('DERIVED_VISUAL'), id: idSchema }).strict(),
    anchorKey: anchorKeySchema,
  })
  .strict();

/**
 * IPC form registration. The referenced article, post, series, document, stash,
 * or visual remains an independent typed aggregate; it does not inherit this DTO.
 */
export const creationFormSchema = z.discriminatedUnion('role', [
  z
    .object({
      ...creationFormRecordShape,
      role: z.literal('ANIMATION'),
      entity: z.object({ kind: z.literal('GIF_DOCUMENT'), id: idSchema }).strict(),
      anchorKey: z.null(),
    })
    .strict(),
  inspirationCreationFormSchema,
  imageBreakdownCreationFormSchema,
  imageCreationFormSchema,
  socialPostCreationFormSchema,
  articleCreationFormSchema,
  videoDocumentCreationFormSchema,
  evaluationSuiteCreationFormSchema,
  socialPostCoverCreationFormSchema,
  articleHeaderCreationFormSchema,
  articleInlineCreationFormSchema,
]);

const primaryRoles = new Set<CreationFormRole>(creationPrimaryFormRoleSchema.options);
const singletonRoles = new Set<CreationFormRole>(creationSingletonFormRoleSchema.options);

/** Stable album/sidebar aggregate composed from typed creation-form registrations. */
export const creationItemSchema = z
  .object({
    id: idSchema,
    /** Album membership is projected into the read model; it is not owned by a form. */
    albumId: idSchema.nullable(),
    phase: creationItemPhaseSchema,
    lifecycle: creationItemLifecycleSchema,
    pinned: z.boolean(),
    primaryFormId: idSchema.nullable(),
    /** Explicit order while this aggregate is shown at the creator sidebar root. */
    creatorRootSortOrder: sortOrderSchema.nullable(),
    forms: z.array(creationFormSchema).min(1).max(1_000),
    createdAt: dateTimeSchema,
    updatedAt: dateTimeSchema,
  })
  .strict()
  .superRefine((item, context) => {
    const formIds = new Set<string>();
    const formById = new Map(item.forms.map((form) => [form.id, form] as const));
    const entityRefs = new Set<string>();
    const singletonRoleKeys = new Set<string>();
    const inlineAnchorKeys = new Set<string>();

    for (const [index, form] of item.forms.entries()) {
      if (form.creationItemId !== item.id) {
        context.addIssue({
          code: 'custom',
          path: ['forms', index, 'creationItemId'],
          message: 'A form must belong to the containing creation item',
        });
      }

      if (formIds.has(form.id)) {
        context.addIssue({
          code: 'custom',
          path: ['forms', index, 'id'],
          message: 'Creation form IDs must be unique within an item',
        });
      }
      formIds.add(form.id);

      const entityRefKey = `${form.entity.kind}:${form.entity.id}`;
      if (entityRefs.has(entityRefKey)) {
        context.addIssue({
          code: 'custom',
          path: ['forms', index, 'entity', 'id'],
          message: 'An entity can be registered only once within an item',
        });
      }
      entityRefs.add(entityRefKey);

      if (singletonRoles.has(form.role)) {
        if (singletonRoleKeys.has(form.role)) {
          context.addIssue({
            code: 'custom',
            path: ['forms', index, 'role'],
            message: 'This form role is unique within a creation item',
          });
        }
        singletonRoleKeys.add(form.role);
      } else if (form.role === 'ARTICLE_INLINE') {
        if (inlineAnchorKeys.has(form.anchorKey)) {
          context.addIssue({
            code: 'custom',
            path: ['forms', index, 'anchorKey'],
            message: 'Article inline forms must have unique anchors within a creation item',
          });
        }
        inlineAnchorKeys.add(form.anchorKey);
      }
    }

    for (const [index, form] of item.forms.entries()) {
      if (!form.sourceFormId) continue;
      if (form.sourceFormId === form.id) {
        context.addIssue({
          code: 'custom',
          path: ['forms', index, 'sourceFormId'],
          message: 'A form cannot derive from itself',
        });
        continue;
      }
      if (!formById.has(form.sourceFormId)) {
        context.addIssue({
          code: 'custom',
          path: ['forms', index, 'sourceFormId'],
          message: 'A source form must belong to the same creation item',
        });
        continue;
      }

      const visited = new Set([form.id]);
      let sourceFormId: string | null = form.sourceFormId;
      while (sourceFormId) {
        if (visited.has(sourceFormId)) {
          context.addIssue({
            code: 'custom',
            path: ['forms', index, 'sourceFormId'],
            message: 'Creation form lineage cannot contain a cycle',
          });
          break;
        }
        visited.add(sourceFormId);
        sourceFormId = formById.get(sourceFormId)?.sourceFormId ?? null;
      }
    }

    if (item.phase === 'DRAFT') {
      for (const [index, form] of item.forms.entries()) {
        if (form.role === 'INSPIRATION') continue;
        context.addIssue({
          code: 'custom',
          path: ['forms', index, 'role'],
          message: 'A draft creation item can contain only its inspiration form',
        });
      }
      if (item.primaryFormId !== null) {
        context.addIssue({
          code: 'custom',
          path: ['primaryFormId'],
          message: 'A draft creation item cannot have a primary form',
        });
      }
      return;
    }

    if (item.primaryFormId === null) {
      context.addIssue({
        code: 'custom',
        path: ['primaryFormId'],
        message: 'An active creation item must have a primary form',
      });
      return;
    }

    const primaryForm = item.forms.find((form) => form.id === item.primaryFormId);
    if (!primaryForm) {
      context.addIssue({
        code: 'custom',
        path: ['primaryFormId'],
        message: 'The primary form must belong to the creation item',
      });
      return;
    }
    if (!primaryRoles.has(primaryForm.role)) {
      context.addIssue({
        code: 'custom',
        path: ['primaryFormId'],
        message: 'Inspiration and auxiliary visual forms cannot be primary',
      });
    }
  });

const creationFormAddInputShape = {
  creationItemId: idSchema,
  sourceFormId: idSchema.nullable().default(null),
};

export const creationFormAddOrGetInputSchema = z.discriminatedUnion('role', [
  z
    .object({
      ...creationFormAddInputShape,
      role: z.literal('ANIMATION'),
      entity: z.object({ kind: z.literal('GIF_DOCUMENT'), id: idSchema }).strict(),
      anchorKey: z.null(),
    })
    .strict(),
  z
    .object({
      ...creationFormAddInputShape,
      role: z.literal('INSPIRATION'),
      entity: z.object({ kind: z.literal('INSPIRATION_STASH'), id: idSchema }).strict(),
      anchorKey: z.null(),
    })
    .strict(),
  z
    .object({
      ...creationFormAddInputShape,
      role: z.literal('IMAGE_BREAKDOWN'),
      entity: z.object({ kind: z.literal('IMAGE_BREAKDOWN'), id: idSchema }).strict(),
      anchorKey: z.null(),
    })
    .strict(),
  z
    .object({
      ...creationFormAddInputShape,
      role: z.literal('IMAGE_CREATION'),
      entity: z.object({ kind: z.literal('PROMPT_SERIES'), id: idSchema }).strict(),
      anchorKey: z.null(),
    })
    .strict(),
  z
    .object({
      ...creationFormAddInputShape,
      role: z.literal('SOCIAL_POST'),
      entity: z.object({ kind: z.literal('SOCIAL_POST'), id: idSchema }).strict(),
      anchorKey: z.null(),
    })
    .strict(),
  z
    .object({
      ...creationFormAddInputShape,
      role: z.literal('ARTICLE'),
      entity: z.object({ kind: z.literal('ARTICLE'), id: idSchema }).strict(),
      anchorKey: z.null(),
    })
    .strict(),
  z
    .object({
      ...creationFormAddInputShape,
      role: z.literal('VIDEO_DOCUMENT'),
      entity: z.object({ kind: z.literal('VIDEO_DOCUMENT'), id: idSchema }).strict(),
      anchorKey: z.null(),
    })
    .strict(),
  z
    .object({
      ...creationFormAddInputShape,
      role: z.literal('EVALUATION_SUITE'),
      entity: z.object({ kind: z.literal('EVALUATION_SUITE'), id: idSchema }).strict(),
      anchorKey: z.null(),
    })
    .strict(),
  z
    .object({
      ...creationFormAddInputShape,
      role: z.literal('SOCIAL_POST_COVER'),
      entity: z.object({ kind: z.literal('DERIVED_VISUAL'), id: idSchema }).strict(),
      anchorKey: z.null(),
    })
    .strict(),
  z
    .object({
      ...creationFormAddInputShape,
      role: z.literal('ARTICLE_HEADER'),
      entity: z.object({ kind: z.literal('DERIVED_VISUAL'), id: idSchema }).strict(),
      anchorKey: z.null(),
    })
    .strict(),
  z
    .object({
      ...creationFormAddInputShape,
      role: z.literal('ARTICLE_INLINE'),
      entity: z.object({ kind: z.literal('DERIVED_VISUAL'), id: idSchema }).strict(),
      anchorKey: anchorKeySchema,
    })
    .strict(),
]);

export const creationInitialFormInputSchema = z.discriminatedUnion('role', [
  z
    .object({
      role: z.literal('ANIMATION'),
      entity: z.object({ kind: z.literal('GIF_DOCUMENT'), id: idSchema }).strict(),
      anchorKey: z.null(),
    })
    .strict(),
  z
    .object({
      role: z.literal('INSPIRATION'),
      entity: z.object({ kind: z.literal('INSPIRATION_STASH'), id: idSchema }).strict(),
      anchorKey: z.null(),
    })
    .strict(),
  z
    .object({
      role: z.literal('IMAGE_BREAKDOWN'),
      entity: z.object({ kind: z.literal('IMAGE_BREAKDOWN'), id: idSchema }).strict(),
      anchorKey: z.null(),
    })
    .strict(),
  z
    .object({
      role: z.literal('IMAGE_CREATION'),
      entity: z.object({ kind: z.literal('PROMPT_SERIES'), id: idSchema }).strict(),
      anchorKey: z.null(),
    })
    .strict(),
  z
    .object({
      role: z.literal('SOCIAL_POST'),
      entity: z.object({ kind: z.literal('SOCIAL_POST'), id: idSchema }).strict(),
      anchorKey: z.null(),
    })
    .strict(),
  z
    .object({
      role: z.literal('ARTICLE'),
      entity: z.object({ kind: z.literal('ARTICLE'), id: idSchema }).strict(),
      anchorKey: z.null(),
    })
    .strict(),
  z
    .object({
      role: z.literal('VIDEO_DOCUMENT'),
      entity: z.object({ kind: z.literal('VIDEO_DOCUMENT'), id: idSchema }).strict(),
      anchorKey: z.null(),
    })
    .strict(),
  z
    .object({
      role: z.literal('EVALUATION_SUITE'),
      entity: z.object({ kind: z.literal('EVALUATION_SUITE'), id: idSchema }).strict(),
      anchorKey: z.null(),
    })
    .strict(),
]);

export const creationItemCreateWithFormInputSchema = z
  .object({
    albumId: idSchema.nullable(),
    form: creationInitialFormInputSchema,
  })
  .strict();

export const creationItemGetInputSchema = z.object({ creationItemId: idSchema }).strict();

export const creationItemListInputSchema = z
  .object({
    /** Undefined lists every album; null selects items without album membership. */
    albumId: idSchema.nullable().optional(),
    lifecycle: creationItemLifecycleSchema.default('ACTIVE'),
  })
  .strict();

export const creationItemMoveInputSchema = z
  .object({
    creationItemId: idSchema,
    albumId: idSchema.nullable(),
  })
  .strict();

export const creationItemSetPinnedInputSchema = z
  .object({
    creationItemId: idSchema,
    pinned: z.boolean(),
  })
  .strict();

export const creationItemSetPrimaryInputSchema = z
  .object({
    creationItemId: idSchema,
    formId: idSchema,
  })
  .strict();

export const creationItemGetResultSchema = creationItemSchema.nullable();
export const creationItemListResultSchema = z.array(creationItemSchema).max(100_000);
export const creationFormAddOrGetResultSchema = z
  .object({
    item: creationItemSchema,
    form: creationFormSchema,
    created: z.boolean(),
  })
  .strict()
  .superRefine((result, context) => {
    const memberMatches = result.item.forms.some(
      (form) =>
        form.id === result.form.id &&
        form.creationItemId === result.form.creationItemId &&
        form.role === result.form.role &&
        form.entity.kind === result.form.entity.kind &&
        form.entity.id === result.form.entity.id &&
        form.sourceFormId === result.form.sourceFormId &&
        form.anchorKey === result.form.anchorKey &&
        form.sortOrder === result.form.sortOrder &&
        form.createdAt === result.form.createdAt &&
        form.updatedAt === result.form.updatedAt,
    );
    if (!memberMatches) {
      context.addIssue({
        code: 'custom',
        path: ['form'],
        message: 'The returned form must be the same form contained by the returned creation item',
      });
    }
  });
export const creationItemMoveResultSchema = creationItemSchema;
export const creationItemSetPinnedResultSchema = creationItemSchema;
export const creationItemSetPrimaryResultSchema = creationItemSchema;
export const creationItemCreateWithFormResultSchema = creationFormAddOrGetResultSchema;

export type CreationItemPhase = z.infer<typeof creationItemPhaseSchema>;
export type CreationItemLifecycle = z.infer<typeof creationItemLifecycleSchema>;
export type CreationFormRole = z.infer<typeof creationFormRoleSchema>;
export type CreationPrimaryFormRole = z.infer<typeof creationPrimaryFormRoleSchema>;
export type CreationSingletonFormRole = z.infer<typeof creationSingletonFormRoleSchema>;
export type CreationFormEntityKind = z.infer<typeof creationFormEntityKindSchema>;
export type CreationFormEntityRef = z.infer<typeof creationFormEntityRefSchema>;
export type CreationFormDto = z.infer<typeof creationFormSchema>;
export type CreationItemDto = z.infer<typeof creationItemSchema>;
export type CreationInitialFormInput = z.infer<typeof creationInitialFormInputSchema>;
export type CreationFormAddOrGetInput = z.input<typeof creationFormAddOrGetInputSchema>;
export type CreationItemCreateWithFormInput = z.infer<typeof creationItemCreateWithFormInputSchema>;
export type CreationItemGetInput = z.infer<typeof creationItemGetInputSchema>;
export type CreationItemListInput = z.input<typeof creationItemListInputSchema>;
export type CreationItemMoveInput = z.infer<typeof creationItemMoveInputSchema>;
export type CreationItemSetPinnedInput = z.infer<typeof creationItemSetPinnedInputSchema>;
export type CreationItemSetPrimaryInput = z.infer<typeof creationItemSetPrimaryInputSchema>;
export type CreationItemGetResult = z.infer<typeof creationItemGetResultSchema>;
export type CreationItemListResult = z.infer<typeof creationItemListResultSchema>;
export type CreationFormAddOrGetResult = z.infer<typeof creationFormAddOrGetResultSchema>;
export type CreationItemMoveResult = z.infer<typeof creationItemMoveResultSchema>;
export type CreationItemSetPinnedResult = z.infer<typeof creationItemSetPinnedResultSchema>;
export type CreationItemSetPrimaryResult = z.infer<typeof creationItemSetPrimaryResultSchema>;
export type CreationItemCreateWithFormResult = z.infer<typeof creationItemCreateWithFormResultSchema>;
