import { ulid } from 'ulid';
import { type JsonMap, now, text } from '@/main/database/core/values';
import { PackCatalogRepository } from '@/main/database/packs/pack-catalog-repository';
import { applyPackReleaseSelection } from '@/main/database/packs/pack-release-application';
import {
  type BeginPackInstallAttemptInput,
  type InstallExactPackReleaseInput,
  type PackCatalogRecord,
  type PackInstallAttemptRecord,
  type PackInstallAttemptStatus,
  type PackInstallDependencyResolutionInput,
  type PackInstallOperation,
  type PackInstallationRecord,
  type PackInstallationState,
  installationRecord,
  json,
  nullableText,
  parseObject,
  parseOptionalObject,
  required,
} from '@/main/database/packs/pack-records';

export class PackInstallationRepository extends PackCatalogRepository {
  listPackCatalog(): PackCatalogRecord[] {
    const installations = new Map(this.listPackInstallations(true).map((item) => [item.packId, item]));
    const packs = this.listPacks();
    const releasesByPack = new Map<string, PackCatalogRecord['releases']>(packs.map((pack) => [pack.id, []]));
    const packIds = [...releasesByPack.keys()];
    for (let offset = 0; offset < packIds.length; offset += 400) {
      const chunk = packIds.slice(offset, offset + 400);
      const placeholders = chunk.map(() => '?').join(', ');
      const rows = this.db
        .prepare(
          `SELECT release.id, release.pack_id, release.version,
            release.manifest_version, release.content_hash, release.published_at, release.sealed_at,
            (SELECT COUNT(*) FROM pack_release_items item WHERE item.release_id = release.id) AS item_count,
            (SELECT COUNT(*) FROM pack_dependencies dependency
              WHERE dependency.release_id = release.id) AS dependency_count
          FROM pack_releases release
          WHERE release.pack_id IN (${placeholders}) AND release.sealed_at IS NOT NULL
          ORDER BY release.pack_id, release.created_at DESC, release.id DESC`,
        )
        .all(...chunk) as JsonMap[];
      for (const release of rows) {
        releasesByPack.get(text(release.pack_id))!.push({
          id: text(release.id),
          packId: text(release.pack_id),
          version: text(release.version),
          manifestVersion: Number(release.manifest_version),
          contentHash: text(release.content_hash),
          publishedAt: nullableText(release.published_at),
          sealedAt: text(release.sealed_at),
          itemCount: Number(release.item_count),
          dependencyCount: Number(release.dependency_count),
        });
      }
    }
    return packs.map((pack) => ({
      pack,
      releases: releasesByPack.get(pack.id) ?? [],
      installation: installations.get(pack.id) ?? null,
    }));
  }

  installExactPackRelease(input: InstallExactPackReleaseInput): PackInstallationRecord {
    return this.installExactPackReleaseInternal(input, false);
  }

  repairExactPackRelease(input: InstallExactPackReleaseInput): PackInstallationRecord {
    return this.installExactPackReleaseInternal(input, true);
  }

  private installExactPackReleaseInternal(
    input: InstallExactPackReleaseInput,
    repairExisting: boolean,
  ): PackInstallationRecord {
    const current = this.listPackInstallations(true).find((item) => item.packId === input.packId);
    if (
      current?.deletedAt === null &&
      current.selectedReleaseId === input.releaseId &&
      (current.state === 'INSTALLED' || current.state === 'DISABLED')
    ) {
      if (!repairExisting) return current;
      const attempt = this.beginPackInstallAttempt({
        packId: input.packId,
        targetReleaseId: input.releaseId,
        operation: 'VERIFY',
        transactionId: input.transactionId,
        source: input.source,
      });
      try {
        return this.db.transaction(() => {
          const application = applyPackReleaseSelection(this.storage, input.packId, input.releaseId, input.releaseId);
          return this.completePackInstallAttempt(attempt.id, { ...input.verification, application });
        })();
      } catch (error) {
        this.failPackInstallAttempt(attempt.id, {
          code: 'EXACT_RELEASE_VERIFY_FAILED',
          message: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    }
    const attempt = this.beginPackInstallAttempt({
      packId: input.packId,
      targetReleaseId: input.releaseId,
      operation: current?.selectedReleaseId && !current.deletedAt ? 'UPGRADE' : 'INSTALL',
      transactionId: input.transactionId,
      source: input.source,
      dependencies: input.dependencies,
    });
    try {
      return this.db.transaction(() => {
        const application = applyPackReleaseSelection(
          this.storage,
          input.packId,
          input.releaseId,
          attempt.previousReleaseId,
        );
        return this.completePackInstallAttempt(attempt.id, { ...input.verification, application });
      })();
    } catch (error) {
      this.failPackInstallAttempt(attempt.id, {
        code: 'EXACT_RELEASE_INSTALL_FAILED',
        message: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  beginPackInstallAttempt(input: BeginPackInstallAttemptInput): PackInstallAttemptRecord {
    const packId = required(input.packId, 'Pack id');
    const targetReleaseId = required(input.targetReleaseId, 'Target release id');
    return this.db.transaction(() => {
      const release = this.db
        .prepare('SELECT pack_id FROM pack_releases WHERE id = ? AND sealed_at IS NOT NULL')
        .get(targetReleaseId) as JsonMap | undefined;
      if (!release || text(release.pack_id) !== packId) throw new Error('Target release does not belong to pack');
      const spaceId = this.getLocalSpace().id;
      const existing = this.db
        .prepare('SELECT * FROM pack_installations WHERE space_id = ? AND pack_id = ?')
        .get(spaceId, packId) as JsonMap | undefined;
      if (
        existing &&
        this.db
          .prepare(
            `SELECT 1 FROM pack_install_attempts
          WHERE installation_id = ? AND status = 'RUNNING'`,
          )
          .get(existing.id)
      ) {
        throw new Error('Pack already has a running installation attempt');
      }
      if (
        (input.operation === 'VERIFY' || input.operation === 'REMOVE') &&
        (!existing || existing.deleted_at || !existing.selected_release_id)
      ) {
        throw new Error(`${input.operation.toLowerCase()} requires an installed release`);
      }
      if (
        (input.operation === 'VERIFY' || input.operation === 'REMOVE') &&
        text(existing!.selected_release_id) !== targetReleaseId
      ) {
        throw new Error(`${input.operation.toLowerCase()} must target the selected release`);
      }
      const timestamp = now();
      const installationId = existing ? text(existing.id) : ulid();
      const wasDeleted = Boolean(existing?.deleted_at);
      const previousState = existing && !wasDeleted ? (text(existing.state) as PackInstallationState) : null;
      const previousReleaseId = existing && !wasDeleted ? nullableText(existing.selected_release_id) : null;
      const progressState: PackInstallationState =
        input.operation === 'REMOVE' ? 'REMOVAL_PENDING' : previousReleaseId ? 'UPDATING' : 'INSTALLING';
      if (existing) {
        this.db
          .prepare(
            `UPDATE pack_installations SET selected_release_id = ?, state = ?,
            installation_source_json = ?, removal_requested_at = ?, last_error_json = NULL,
            updated_at = ?, deleted_at = NULL WHERE id = ?`,
          )
          .run(
            wasDeleted ? null : existing.selected_release_id,
            progressState,
            json(input.source, {}),
            input.operation === 'REMOVE' ? timestamp : null,
            timestamp,
            installationId,
          );
      } else {
        this.db
          .prepare(
            `INSERT INTO pack_installations
            (id, space_id, pack_id, selected_release_id, state, installation_source_json, installed_at,
              disabled_at, removal_requested_at, last_error_json, created_at, updated_at, deleted_at)
            VALUES (?, ?, ?, NULL, ?, ?, NULL, NULL, ?, NULL, ?, ?, NULL)`,
          )
          .run(
            installationId,
            spaceId,
            packId,
            progressState,
            json(input.source, {}),
            input.operation === 'REMOVE' ? timestamp : null,
            timestamp,
            timestamp,
          );
      }

      const attemptId = ulid();
      this.db
        .prepare(
          `INSERT INTO pack_install_attempts
          (id, installation_id, transaction_id, operation, target_release_id, status,
            previous_installation_state, previous_release_id, source_json, verification_json,
            error_json, started_at, finished_at)
          VALUES (?, ?, ?, ?, ?, 'RUNNING', ?, ?, ?, NULL, NULL, ?, NULL)`,
        )
        .run(
          attemptId,
          installationId,
          input.transactionId?.trim() || ulid(),
          input.operation,
          targetReleaseId,
          previousState,
          previousReleaseId,
          json(input.source, {}),
          timestamp,
        );
      const resolutions = this.resolveAttemptDependencies(targetReleaseId, input.operation, input.dependencies ?? []);
      for (const resolution of resolutions) {
        this.db
          .prepare(
            `INSERT INTO pack_install_attempt_dependencies
            (id, attempt_id, dependency_id, resolution_kind, resolved_release_id, created_at)
            VALUES (?, ?, ?, ?, ?, ?)`,
          )
          .run(
            ulid(),
            attemptId,
            resolution.dependencyId,
            resolution.resolutionKind,
            resolution.resolvedReleaseId ?? null,
            timestamp,
          );
      }
      this.storage.recordChange('PACK_INSTALL_ATTEMPT', attemptId, 'START', {
        installationId,
        operation: input.operation,
        targetReleaseId,
      });
      return this.getPackInstallAttempt(attemptId);
    })();
  }

  completePackInstallAttempt(attemptId: string, verification: JsonMap = {}): PackInstallationRecord {
    return this.db.transaction(() => {
      const attempt = this.requireRunningAttempt(attemptId);
      const installation = this.db
        .prepare('SELECT * FROM pack_installations WHERE id = ?')
        .get(attempt.installationId) as JsonMap | undefined;
      if (!installation) throw new Error('Pack installation is unavailable');
      if (attempt.operation !== 'REMOVE' && attempt.operation !== 'VERIFY') {
        this.assertAttemptDependenciesInstalled(attempt, text(installation.space_id));
      }
      const timestamp = now();
      if (attempt.operation === 'REMOVE') {
        const activeActivation = this.db
          .prepare(
            `SELECT 1 FROM context_pack_activations
            WHERE installation_id = ? AND state = 'EXPLICIT_ACTIVE' AND deleted_at IS NULL LIMIT 1`,
          )
          .get(attempt.installationId);
        if (activeActivation) throw new Error('Disable or remove active pack contexts before removal');
        this.db
          .prepare(
            `UPDATE pack_installations SET state = 'REMOVED', disabled_at = ?,
            removal_requested_at = NULL, last_error_json = NULL, updated_at = ?, deleted_at = ? WHERE id = ?`,
          )
          .run(timestamp, timestamp, timestamp, attempt.installationId);
        this.addTombstone('PACK_INSTALLATION', attempt.installationId, timestamp);
      } else if (attempt.operation === 'VERIFY') {
        if (!attempt.previousInstallationState || !attempt.previousReleaseId) {
          throw new Error('Cannot verify a pack without an installed release');
        }
        this.db
          .prepare(
            `UPDATE pack_installations SET selected_release_id = ?, state = ?,
            removal_requested_at = NULL, last_error_json = NULL, updated_at = ? WHERE id = ?`,
          )
          .run(attempt.previousReleaseId, attempt.previousInstallationState, timestamp, attempt.installationId);
      } else {
        const installedState = attempt.previousInstallationState === 'DISABLED' ? 'DISABLED' : 'INSTALLED';
        this.db
          .prepare(
            `UPDATE pack_installations SET selected_release_id = ?, state = ?,
            installed_at = COALESCE(installed_at, ?),
            disabled_at = CASE WHEN ? = 'DISABLED' THEN COALESCE(disabled_at, ?) ELSE NULL END,
            removal_requested_at = NULL,
            last_error_json = NULL, updated_at = ?, deleted_at = NULL WHERE id = ?`,
          )
          .run(
            attempt.targetReleaseId,
            installedState,
            timestamp,
            installedState,
            timestamp,
            timestamp,
            attempt.installationId,
          );
      }
      this.db
        .prepare(
          `UPDATE pack_install_attempts SET status = 'SUCCEEDED', verification_json = ?,
          finished_at = ? WHERE id = ? AND status = 'RUNNING'`,
        )
        .run(json(verification, {}), timestamp, attempt.id);
      this.storage.recordChange('PACK_INSTALL_ATTEMPT', attempt.id, 'SUCCEED', {
        installationId: attempt.installationId,
        targetReleaseId: attempt.targetReleaseId,
      });
      this.storage.recordChange(
        'PACK_INSTALLATION',
        attempt.installationId,
        attempt.operation === 'REMOVE' ? 'DELETE' : 'SELECT_RELEASE',
        {
          releaseId: attempt.targetReleaseId,
          attemptId: attempt.id,
        },
      );
      return installationRecord(
        this.db.prepare('SELECT * FROM pack_installations WHERE id = ?').get(attempt.installationId) as JsonMap,
      );
    })();
  }

  failPackInstallAttempt(attemptId: string, error: JsonMap): PackInstallationRecord {
    return this.db.transaction(() => {
      const attempt = this.requireRunningAttempt(attemptId);
      const timestamp = now();
      const restoredState = attempt.previousInstallationState ?? 'FAILED_NO_USABLE_RELEASE';
      this.db
        .prepare(
          `UPDATE pack_installations SET selected_release_id = ?, state = ?,
          disabled_at = CASE WHEN ? = 'DISABLED' THEN disabled_at ELSE NULL END,
          removal_requested_at = NULL, last_error_json = ?, updated_at = ? WHERE id = ?`,
        )
        .run(
          attempt.previousReleaseId,
          restoredState,
          restoredState,
          json(error, {}),
          timestamp,
          attempt.installationId,
        );
      this.db
        .prepare(
          `UPDATE pack_install_attempts SET status = 'FAILED', error_json = ?, finished_at = ?
          WHERE id = ? AND status = 'RUNNING'`,
        )
        .run(json(error, {}), timestamp, attempt.id);
      this.storage.recordChange('PACK_INSTALL_ATTEMPT', attempt.id, 'FAIL', {
        installationId: attempt.installationId,
        error,
      });
      return installationRecord(
        this.db.prepare('SELECT * FROM pack_installations WHERE id = ?').get(attempt.installationId) as JsonMap,
      );
    })();
  }

  cancelPackInstallAttempt(attemptId: string, reason: JsonMap = {}): PackInstallationRecord {
    return this.db.transaction(() => {
      const attempt = this.requireRunningAttempt(attemptId);
      const timestamp = now();
      const error = { code: 'CANCELLED', ...reason };
      this.db
        .prepare(
          `UPDATE pack_installations SET selected_release_id = ?, state = ?,
          disabled_at = CASE WHEN ? = 'DISABLED' THEN disabled_at ELSE NULL END,
          removal_requested_at = NULL, last_error_json = NULL, updated_at = ? WHERE id = ?`,
        )
        .run(
          attempt.previousReleaseId,
          attempt.previousInstallationState ?? 'FAILED_NO_USABLE_RELEASE',
          attempt.previousInstallationState ?? 'FAILED_NO_USABLE_RELEASE',
          timestamp,
          attempt.installationId,
        );
      this.db
        .prepare(
          `UPDATE pack_install_attempts SET status = 'CANCELLED', error_json = ?, finished_at = ?
          WHERE id = ? AND status = 'RUNNING'`,
        )
        .run(json(error, {}), timestamp, attempt.id);
      this.storage.recordChange('PACK_INSTALL_ATTEMPT', attempt.id, 'CANCEL', {
        installationId: attempt.installationId,
        reason,
      });
      return installationRecord(
        this.db.prepare('SELECT * FROM pack_installations WHERE id = ?').get(attempt.installationId) as JsonMap,
      );
    })();
  }

  reconcileInterruptedPackInstallAttempts(): number {
    return this.db.transaction(() => {
      const running = this.db
        .prepare("SELECT id FROM pack_install_attempts WHERE status = 'RUNNING'")
        .all() as JsonMap[];
      for (const row of running) {
        const attempt = this.requireRunningAttempt(text(row.id));
        const timestamp = now();
        const error = { code: 'APP_RESTARTED', message: 'Installation attempt interrupted by restart' };
        this.db
          .prepare(
            `UPDATE pack_installations SET selected_release_id = ?, state = ?,
            removal_requested_at = NULL, last_error_json = ?, updated_at = ? WHERE id = ?`,
          )
          .run(
            attempt.previousReleaseId,
            attempt.previousInstallationState ?? 'FAILED_NO_USABLE_RELEASE',
            json(error, {}),
            timestamp,
            attempt.installationId,
          );
        this.db
          .prepare(
            `UPDATE pack_install_attempts SET status = 'INTERRUPTED', error_json = ?, finished_at = ?
            WHERE id = ?`,
          )
          .run(json(error, {}), timestamp, attempt.id);
        this.storage.recordChange('PACK_INSTALL_ATTEMPT', attempt.id, 'INTERRUPT', {
          installationId: attempt.installationId,
        });
      }
      return running.length;
    })();
  }

  setPackInstallationDisabled(packId: string, disabled: boolean): PackInstallationRecord {
    return this.db.transaction(() => {
      const spaceId = this.getLocalSpace().id;
      const row = this.db
        .prepare(
          `SELECT * FROM pack_installations
          WHERE space_id = ? AND pack_id = ? AND deleted_at IS NULL`,
        )
        .get(spaceId, packId) as JsonMap | undefined;
      if (!row || !row.selected_release_id) throw new Error('Pack is not installed');
      if (text(row.state) === 'INSTALLING' || text(row.state) === 'UPDATING' || text(row.state) === 'REMOVAL_PENDING') {
        throw new Error('Pack installation has an active operation');
      }
      const state: PackInstallationState = disabled ? 'DISABLED' : 'INSTALLED';
      const timestamp = now();
      this.db
        .prepare(`UPDATE pack_installations SET state = ?, disabled_at = ?, updated_at = ? WHERE id = ?`)
        .run(state, disabled ? timestamp : null, timestamp, row.id);
      this.storage.recordChange('PACK_INSTALLATION', text(row.id), disabled ? 'DISABLE' : 'ENABLE', {});
      return installationRecord(
        this.db.prepare('SELECT * FROM pack_installations WHERE id = ?').get(row.id) as JsonMap,
      );
    })();
  }

  listPackInstallations(includeRemoved = false): PackInstallationRecord[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM pack_installations
        WHERE (? = 1 OR deleted_at IS NULL) ORDER BY created_at, id`,
      )
      .all(includeRemoved ? 1 : 0) as JsonMap[];
    return rows.map(installationRecord);
  }

  getPackInstallAttempt(attemptId: string): PackInstallAttemptRecord {
    const row = this.db.prepare('SELECT * FROM pack_install_attempts WHERE id = ?').get(attemptId) as
      JsonMap | undefined;
    if (!row) throw new Error('Pack installation attempt not found');
    return {
      id: text(row.id),
      installationId: text(row.installation_id),
      transactionId: text(row.transaction_id),
      operation: text(row.operation) as PackInstallOperation,
      targetReleaseId: text(row.target_release_id),
      status: text(row.status) as PackInstallAttemptStatus,
      previousInstallationState: nullableText(row.previous_installation_state) as PackInstallationState | null,
      previousReleaseId: nullableText(row.previous_release_id),
      source: parseObject(row.source_json),
      verification: parseOptionalObject(row.verification_json),
      error: parseOptionalObject(row.error_json),
      startedAt: text(row.started_at),
      finishedAt: nullableText(row.finished_at),
      dependencies: (
        this.db
          .prepare(
            `SELECT * FROM pack_install_attempt_dependencies
          WHERE attempt_id = ? ORDER BY id`,
          )
          .all(attemptId) as JsonMap[]
      ).map((dependency) => ({
        id: text(dependency.id),
        attemptId: text(dependency.attempt_id),
        dependencyId: text(dependency.dependency_id),
        resolutionKind: text(dependency.resolution_kind) as 'LOCKED' | 'OMITTED',
        resolvedReleaseId: nullableText(dependency.resolved_release_id),
        createdAt: text(dependency.created_at),
      })),
    };
  }

  private resolveAttemptDependencies(
    targetReleaseId: string,
    operation: PackInstallOperation,
    requested: PackInstallDependencyResolutionInput[],
  ) {
    if (operation === 'REMOVE' || operation === 'VERIFY') {
      if (requested.length > 0) throw new Error(`${operation.toLowerCase()} attempts do not accept dependency locks`);
      return [];
    }
    const declared = this.db
      .prepare('SELECT * FROM pack_dependencies WHERE release_id = ? ORDER BY sort_order, id')
      .all(targetReleaseId) as JsonMap[];
    const byId = new Map(requested.map((resolution) => [resolution.dependencyId, resolution]));
    if (byId.size !== requested.length) throw new Error('Duplicate dependency resolution');
    for (const dependencyId of byId.keys()) {
      if (!declared.some((dependency) => text(dependency.id) === dependencyId)) {
        throw new Error('Dependency resolution does not belong to target release');
      }
    }
    return declared.map((dependency) => {
      const dependencyId = text(dependency.id);
      const resolution = byId.get(dependencyId) ?? {
        dependencyId,
        resolutionKind: 'OMITTED' as const,
        resolvedReleaseId: null,
      };
      if (text(dependency.dependency_kind) === 'REQUIRED' && resolution.resolutionKind !== 'LOCKED') {
        throw new Error('Required dependency must resolve to an exact release');
      }
      if (resolution.resolutionKind === 'OMITTED') {
        if (resolution.resolvedReleaseId) throw new Error('Omitted dependency cannot have a release');
        return { ...resolution, resolvedReleaseId: null };
      }
      const resolvedReleaseId = required(resolution.resolvedReleaseId ?? '', 'Resolved dependency release id');
      const resolved = this.db
        .prepare('SELECT pack_id FROM pack_releases WHERE id = ? AND sealed_at IS NOT NULL')
        .get(resolvedReleaseId) as JsonMap | undefined;
      if (!resolved || text(resolved.pack_id) !== text(dependency.target_pack_id)) {
        throw new Error('Resolved dependency release does not belong to dependency pack');
      }
      const declaredLock = nullableText(dependency.locked_release_id);
      if (declaredLock && declaredLock !== resolvedReleaseId) {
        throw new Error('Resolved dependency release conflicts with manifest lock');
      }
      return { ...resolution, resolvedReleaseId };
    });
  }

  private requireRunningAttempt(attemptId: string) {
    const attempt = this.getPackInstallAttempt(attemptId);
    if (attempt.status !== 'RUNNING') throw new Error('Pack installation attempt is no longer running');
    return attempt;
  }

  private assertAttemptDependenciesInstalled(attempt: PackInstallAttemptRecord, spaceId: string) {
    const declared = this.db
      .prepare('SELECT * FROM pack_dependencies WHERE release_id = ?')
      .all(attempt.targetReleaseId) as JsonMap[];
    const resolutions = new Map(attempt.dependencies.map((resolution) => [resolution.dependencyId, resolution]));
    for (const dependency of declared) {
      const resolution = resolutions.get(text(dependency.id));
      if (text(dependency.dependency_kind) === 'REQUIRED' && resolution?.resolutionKind !== 'LOCKED') {
        throw new Error('Required dependency is not locked');
      }
      if (!resolution || resolution.resolutionKind === 'OMITTED') continue;
      const installed = this.db
        .prepare(
          `SELECT 1 FROM pack_installations
          WHERE space_id = ? AND pack_id = ? AND selected_release_id = ?
            AND state = 'INSTALLED' AND deleted_at IS NULL`,
        )
        .get(spaceId, dependency.target_pack_id, resolution.resolvedReleaseId);
      if (!installed) throw new Error(`Dependency is not installed: ${text(dependency.target_pack_id)}`);
    }
  }
}
