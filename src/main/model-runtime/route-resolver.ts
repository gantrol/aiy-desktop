import {
  intersectModelRuntimeCapabilities,
  modelRuntimeCapabilityMismatches,
  type ModelRuntimeCapabilityMismatch,
} from '@/main/model-runtime/capabilities';
import {
  modelRuntimeRouteDefinitionSchema,
  modelRuntimeRouteSnapshotSchema,
  modelRuntimeTaskRequirementSchema,
  type ModelRuntimeRouteDefinition,
  type ModelRuntimeRouteSnapshot,
  type ModelRuntimeTaskRequirement,
} from '@/main/model-runtime/contracts';

export type ModelRuntimeRouteExclusionReason =
  | 'INVALID_DEFINITION'
  | 'NOT_SELECTED_BY_LOCK'
  | 'DISABLED'
  | 'UNAVAILABLE'
  | 'OPERATION_MISMATCH'
  | 'CAPABILITY_MISMATCH';

export interface ModelRuntimeRouteExclusion {
  routeId: string;
  reason: ModelRuntimeRouteExclusionReason;
  capabilityMismatches: ModelRuntimeCapabilityMismatch[];
  diagnostic: string | null;
}

export interface ModelRuntimeRouteResolutionFailure {
  ok: false;
  code: 'INVALID_REQUEST' | 'ROUTE_UNAVAILABLE';
  exclusions: ModelRuntimeRouteExclusion[];
  diagnostic: string;
}

export interface ModelRuntimeRouteResolutionSuccess {
  ok: true;
  route: ModelRuntimeRouteSnapshot;
}

export type ModelRuntimeRouteResolution = ModelRuntimeRouteResolutionSuccess | ModelRuntimeRouteResolutionFailure;

export interface ResolveModelRuntimeRouteOptions {
  routes: readonly unknown[];
  requirement: unknown;
  lockedRouteId?: string | null;
  preferredRouteIds?: readonly string[];
  now?: () => Date;
}

function issueSummary(error: { issues: readonly { path: PropertyKey[]; message: string }[] }) {
  return error.issues
    .slice(0, 4)
    .map((issue) => `${issue.path.length ? issue.path.join('.') : '$'}: ${issue.message}`)
    .join('; ')
    .slice(0, 800);
}

function candidateId(value: unknown, index: number) {
  if (value && typeof value === 'object' && 'routeId' in value && typeof value.routeId === 'string') {
    return value.routeId.slice(0, 200);
  }
  return `candidate-${index + 1}`;
}

function freezeRouteSnapshot(snapshot: ModelRuntimeRouteSnapshot) {
  for (const value of Object.values(snapshot.effectiveCapabilities)) Object.freeze(value);
  Object.freeze(snapshot.effectiveCapabilities);
  return Object.freeze(snapshot);
}

function routePreference(route: ModelRuntimeRouteDefinition, preferredRouteIds: readonly string[]) {
  const index = preferredRouteIds.indexOf(route.routeId);
  return index < 0 ? Number.MAX_SAFE_INTEGER : index;
}

export function resolveModelRuntimeRoute(options: ResolveModelRuntimeRouteOptions): ModelRuntimeRouteResolution {
  const decodedRequirement = modelRuntimeTaskRequirementSchema.safeParse(options.requirement);
  if (!decodedRequirement.success) {
    return {
      ok: false,
      code: 'INVALID_REQUEST',
      exclusions: [],
      diagnostic: `Invalid model task requirement: ${issueSummary(decodedRequirement.error)}`,
    };
  }
  const requirement: ModelRuntimeTaskRequirement = decodedRequirement.data;
  const exclusions: ModelRuntimeRouteExclusion[] = [];
  const candidates: Array<{ route: ModelRuntimeRouteDefinition; index: number }> = [];

  options.routes.forEach((value, index) => {
    const decoded = modelRuntimeRouteDefinitionSchema.safeParse(value);
    if (!decoded.success) {
      exclusions.push({
        routeId: candidateId(value, index),
        reason: 'INVALID_DEFINITION',
        capabilityMismatches: [],
        diagnostic: issueSummary(decoded.error),
      });
      return;
    }
    const route = decoded.data;
    if (options.lockedRouteId && route.routeId !== options.lockedRouteId) {
      exclusions.push({
        routeId: route.routeId,
        reason: 'NOT_SELECTED_BY_LOCK',
        capabilityMismatches: [],
        diagnostic: null,
      });
      return;
    }
    if (route.state !== 'AVAILABLE') {
      exclusions.push({
        routeId: route.routeId,
        reason: route.state === 'DISABLED' ? 'DISABLED' : 'UNAVAILABLE',
        capabilityMismatches: [],
        diagnostic: null,
      });
      return;
    }
    if (route.operation !== requirement.operation) {
      exclusions.push({
        routeId: route.routeId,
        reason: 'OPERATION_MISMATCH',
        capabilityMismatches: [],
        diagnostic: null,
      });
      return;
    }
    const effectiveCapabilities = intersectModelRuntimeCapabilities([
      route.modelCapabilities,
      route.adapterCapabilities,
      route.routeCapabilities,
      route.connectionCapabilities,
    ]);
    const capabilityMismatches = modelRuntimeCapabilityMismatches(effectiveCapabilities, requirement);
    if (capabilityMismatches.length > 0) {
      exclusions.push({
        routeId: route.routeId,
        reason: 'CAPABILITY_MISMATCH',
        capabilityMismatches,
        diagnostic: null,
      });
      return;
    }
    candidates.push({ route: { ...route, modelCapabilities: effectiveCapabilities }, index });
  });

  const preferredRouteIds = options.preferredRouteIds ?? [];
  candidates.sort((left, right) => {
    const preferred = routePreference(left.route, preferredRouteIds) - routePreference(right.route, preferredRouteIds);
    if (preferred !== 0) return preferred;
    if (left.route.priority !== right.route.priority) return right.route.priority - left.route.priority;
    return left.index - right.index;
  });
  const selected = candidates[0]?.route;
  if (!selected) {
    const lockedRouteMissing =
      options.lockedRouteId && !options.routes.some((route) => candidateId(route, -1) === options.lockedRouteId);
    return {
      ok: false,
      code: 'ROUTE_UNAVAILABLE',
      exclusions,
      diagnostic: lockedRouteMissing
        ? `Locked model route ${options.lockedRouteId} is unavailable`
        : 'No model route satisfies the task requirement',
    };
  }

  const snapshot = modelRuntimeRouteSnapshotSchema.parse({
    routeId: selected.routeId,
    routeRevision: selected.routeRevision,
    providerId: selected.providerId,
    connectionId: selected.connectionId,
    connectionRevision: selected.connectionRevision,
    adapterId: selected.adapterId,
    adapterRevision: selected.adapterRevision,
    modelId: selected.modelId,
    modelCatalogRevision: selected.modelCatalogRevision,
    promptProfileId: selected.promptProfileId,
    promptProfileRevision: selected.promptProfileRevision,
    resourcePoolKey: selected.resourcePoolKey,
    operation: selected.operation,
    effectiveCapabilities: selected.modelCapabilities,
    selectedAt: (options.now ?? (() => new Date()))().toISOString(),
  });
  return { ok: true, route: freezeRouteSnapshot(snapshot) };
}
