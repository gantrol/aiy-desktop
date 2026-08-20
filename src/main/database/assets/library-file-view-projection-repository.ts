import { existsSync, linkSync, lstatSync, mkdirSync, readdirSync, realpathSync, rmdirSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { type ResolvedAssetFile, safeAssetFileName } from '@/main/database/assets/asset-file-repository';
import { LibraryFileViewIndexRepository } from '@/main/database/assets/library-file-view-index-repository';
import {
  type AlbumNode,
  type DesiredLink,
  type IndexedDirectory,
  type IndexedLink,
  type TermDirectoryNode,
  collisionKey,
  directoryKey,
  ensureReadOnly,
  isNumberedDirectoryName,
  isNumberedFileName,
  linkKey,
  maximumConflictAttempts,
  nodeErrorCode,
  numberedDirectoryName,
  numberedFileName,
  safeDirectoryLabel,
  sameFile,
  termLinkKey,
} from '@/main/database/assets/library-file-view-values';
import { type JsonMap, text } from '@/main/database/core/values';

export class LibraryFileViewProjectionRepository extends LibraryFileViewIndexRepository {
  protected reconcileAlbumDirectories(
    root: string,
    albumsRoot: string,
    albums: Map<string, AlbumNode>,
    previousDirectories: IndexedDirectory[],
  ) {
    const directories = new Map<string, string>();
    const previousByAlbum = new Map<string, IndexedDirectory>();
    for (const entry of previousDirectories) {
      if (entry.contextType !== 'ALBUM') continue;
      const existing = previousByAlbum.get(entry.contextId);
      if (!existing || (entry.preferredLabel && !existing.preferredLabel)) {
        previousByAlbum.set(entry.contextId, entry);
      }
    }

    const nodes = [...albums.values()].sort((left, right) => {
      const depthDifference = this.albumDepth(left.id, albums) - this.albumDepth(right.id, albums);
      if (depthDifference) return depthDifference;
      const leftPrevious = previousByAlbum.get(left.id);
      const rightPrevious = previousByAlbum.get(right.id);
      const leftStable = leftPrevious?.preferredLabel === safeDirectoryLabel(left.title) ? 0 : 1;
      const rightStable = rightPrevious?.preferredLabel === safeDirectoryLabel(right.title) ? 0 : 1;
      return (
        leftStable - rightStable || left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id)
      );
    });

    const claimedByParent = new Map<string, Set<string>>();
    for (const node of nodes) {
      const parentDirectory = node.parentId ? directories.get(node.parentId) : albumsRoot;
      if (!parentDirectory) continue;
      const parentKey = this.absolutePathKey(parentDirectory);
      let claimed = claimedByParent.get(parentKey);
      if (!claimed) {
        claimed = new Set(readdirSync(parentDirectory).map((name) => collisionKey(name)));
        claimedByParent.set(parentKey, claimed);
      }

      const preferredLabel = safeDirectoryLabel(node.title);
      const previous = previousByAlbum.get(node.id);
      let selectedName = '';
      if (previous?.preferredLabel === preferredLabel) {
        const previousName = path.basename(this.absoluteManagedPath(root, previous.relativePath));
        const previousParent = path.dirname(this.absoluteManagedPath(root, previous.relativePath));
        if (isNumberedDirectoryName(previousName, preferredLabel)) {
          if (this.absolutePathKey(previousParent) === parentKey) claimed.delete(collisionKey(previousName));
          if (!claimed.has(collisionKey(previousName))) selectedName = previousName;
        }
      }
      if (!selectedName) {
        for (let attempt = 1; attempt <= maximumConflictAttempts; attempt += 1) {
          const candidate = numberedDirectoryName(preferredLabel, attempt);
          if (!claimed.has(collisionKey(candidate))) {
            selectedName = candidate;
            break;
          }
        }
      }
      if (!selectedName) throw new Error(`Unable to allocate a directory name for album ${node.id}`);
      claimed.add(collisionKey(selectedName));

      const destination = path.resolve(parentDirectory, selectedName);
      this.assertInside(root, destination);
      if (!existsSync(destination)) mkdirSync(destination);
      const entry = lstatSync(destination);
      if (entry.isSymbolicLink() || !entry.isDirectory()) {
        throw new Error(`Album directory is unavailable: ${selectedName}`);
      }
      const resolved = realpathSync(destination);
      this.assertInside(root, resolved);
      directories.set(node.id, resolved);
    }
    return directories;
  }

  protected reconcileTermDirectories(
    root: string,
    termsRoot: string,
    terms: TermDirectoryNode[],
    previousDirectories: IndexedDirectory[],
  ) {
    const previousByKey = new Map(
      previousDirectories.filter((entry) => entry.contextType !== 'ALBUM').map((entry) => [entry.key, entry]),
    );
    const claimedByParent = new Map<string, Set<string>>();
    const directories: IndexedDirectory[] = [];
    const domainDirectories = new Map<string, string>();
    const typeDirectories = new Map<string, string>();
    const termDirectories = new Map<string, string>();

    const domains = new Map<string, { id: string; name: string; createdAt: string }>();
    for (const term of terms) {
      const current = domains.get(term.domainId);
      if (!current || term.createdAt < current.createdAt) {
        domains.set(term.domainId, { id: term.domainId, name: term.domainName, createdAt: term.createdAt });
      }
    }
    const sortedDomains = [...domains.values()].sort((left, right) =>
      this.stableDirectoryOrder(
        directoryKey('TERM_DOMAIN', left.id),
        left.name,
        left.createdAt,
        directoryKey('TERM_DOMAIN', right.id),
        right.name,
        right.createdAt,
        previousByKey,
      ),
    );
    for (const domain of sortedDomains) {
      const key = directoryKey('TERM_DOMAIN', domain.id);
      const preferredLabel = safeDirectoryLabel(domain.name, '未分类');
      const absolutePath = this.allocateProjectionDirectory(
        root,
        termsRoot,
        preferredLabel,
        previousByKey.get(key),
        claimedByParent,
      );
      domainDirectories.set(domain.id, absolutePath);
      directories.push({
        key,
        contextType: 'TERM_DOMAIN',
        contextId: domain.id,
        parentKey: null,
        state: 'ACTIVE',
        relativePath: this.relativeManagedPath(root, absolutePath),
        preferredLabel,
      });
    }

    const types = new Map<
      string,
      {
        contextId: string;
        domainId: string;
        name: string;
        createdAt: string;
      }
    >();
    for (const term of terms) {
      if (!term.typeId) continue;
      const contextId = JSON.stringify([term.domainId, term.typeId]);
      const current = types.get(contextId);
      if (!current || term.createdAt < current.createdAt) {
        types.set(contextId, {
          contextId,
          domainId: term.domainId,
          name: term.typeName,
          createdAt: term.createdAt,
        });
      }
    }
    const sortedTypes = [...types.values()].sort(
      (left, right) =>
        left.domainId.localeCompare(right.domainId) ||
        this.stableDirectoryOrder(
          directoryKey('TERM_TYPE', left.contextId),
          left.name,
          left.createdAt,
          directoryKey('TERM_TYPE', right.contextId),
          right.name,
          right.createdAt,
          previousByKey,
        ),
    );
    for (const type of sortedTypes) {
      const parentDirectory = domainDirectories.get(type.domainId);
      if (!parentDirectory) continue;
      const key = directoryKey('TERM_TYPE', type.contextId);
      const preferredLabel = safeDirectoryLabel(type.name, '未分类');
      const absolutePath = this.allocateProjectionDirectory(
        root,
        parentDirectory,
        preferredLabel,
        previousByKey.get(key),
        claimedByParent,
      );
      typeDirectories.set(type.contextId, absolutePath);
      directories.push({
        key,
        contextType: 'TERM_TYPE',
        contextId: type.contextId,
        parentKey: directoryKey('TERM_DOMAIN', type.domainId),
        state: 'ACTIVE',
        relativePath: this.relativeManagedPath(root, absolutePath),
        preferredLabel,
      });
    }

    const sortedTerms = [...terms].sort((left, right) => {
      const leftParent = left.typeId ? JSON.stringify([left.domainId, left.typeId]) : left.domainId;
      const rightParent = right.typeId ? JSON.stringify([right.domainId, right.typeId]) : right.domainId;
      return (
        leftParent.localeCompare(rightParent) ||
        this.stableDirectoryOrder(
          directoryKey('TERM', left.id),
          left.name,
          left.createdAt,
          directoryKey('TERM', right.id),
          right.name,
          right.createdAt,
          previousByKey,
        )
      );
    });
    for (const term of sortedTerms) {
      const typeContextId = JSON.stringify([term.domainId, term.typeId]);
      const parentDirectory = term.typeId ? typeDirectories.get(typeContextId) : domainDirectories.get(term.domainId);
      if (!parentDirectory) continue;
      const key = directoryKey('TERM', term.id);
      const preferredLabel = safeDirectoryLabel(term.name, '未命名词条');
      const absolutePath = this.allocateProjectionDirectory(
        root,
        parentDirectory,
        preferredLabel,
        previousByKey.get(key),
        claimedByParent,
      );
      termDirectories.set(term.id, absolutePath);
      directories.push({
        key,
        contextType: 'TERM',
        contextId: term.id,
        parentKey: term.typeId ? directoryKey('TERM_TYPE', typeContextId) : directoryKey('TERM_DOMAIN', term.domainId),
        state: 'ACTIVE',
        relativePath: this.relativeManagedPath(root, absolutePath),
        preferredLabel,
      });
    }
    return { termDirectories, directories };
  }

  protected stableDirectoryOrder(
    leftKey: string,
    leftName: string,
    leftCreatedAt: string,
    rightKey: string,
    rightName: string,
    rightCreatedAt: string,
    previousByKey: Map<string, IndexedDirectory>,
  ) {
    const leftStable = previousByKey.get(leftKey)?.preferredLabel === safeDirectoryLabel(leftName, '未分类') ? 0 : 1;
    const rightStable = previousByKey.get(rightKey)?.preferredLabel === safeDirectoryLabel(rightName, '未分类') ? 0 : 1;
    return leftStable - rightStable || leftCreatedAt.localeCompare(rightCreatedAt) || leftKey.localeCompare(rightKey);
  }

  protected allocateProjectionDirectory(
    root: string,
    parentDirectory: string,
    preferredLabel: string,
    previous: IndexedDirectory | undefined,
    claimedByParent: Map<string, Set<string>>,
  ) {
    const parentKey = this.absolutePathKey(parentDirectory);
    let claimed = claimedByParent.get(parentKey);
    if (!claimed) {
      claimed = new Set(readdirSync(parentDirectory).map((name) => collisionKey(name)));
      claimedByParent.set(parentKey, claimed);
    }

    let selectedName = '';
    if (previous?.preferredLabel === preferredLabel) {
      const previousPath = this.absoluteManagedPath(root, previous.relativePath);
      const previousName = path.basename(previousPath);
      const previousParent = path.dirname(previousPath);
      if (isNumberedDirectoryName(previousName, preferredLabel)) {
        if (this.absolutePathKey(previousParent) === parentKey) claimed.delete(collisionKey(previousName));
        if (!claimed.has(collisionKey(previousName))) selectedName = previousName;
      }
    }
    if (!selectedName) {
      for (let attempt = 1; attempt <= maximumConflictAttempts; attempt += 1) {
        const candidate = numberedDirectoryName(preferredLabel, attempt);
        if (!claimed.has(collisionKey(candidate))) {
          selectedName = candidate;
          break;
        }
      }
    }
    if (!selectedName) throw new Error(`Unable to allocate a managed directory for ${preferredLabel}`);
    claimed.add(collisionKey(selectedName));

    const destination = path.resolve(parentDirectory, selectedName);
    this.assertInside(root, destination);
    if (!existsSync(destination)) mkdirSync(destination);
    const entry = lstatSync(destination);
    if (entry.isSymbolicLink() || !entry.isDirectory()) {
      throw new Error(`Managed directory is unavailable: ${selectedName}`);
    }
    const resolved = realpathSync(destination);
    this.assertInside(root, resolved);
    return resolved;
  }

  protected buildDesiredLinks(
    root: string,
    assets: Map<string, ResolvedAssetFile>,
    albumDirectories: Map<string, string>,
    termDirectories: Map<string, string>,
    terms: TermDirectoryNode[],
  ) {
    const desired = new Map<string, DesiredLink>();

    const rows = this.db
      .prepare(
        `SELECT member.album_id, material.image_asset_id AS asset_id
        FROM album_members member
        JOIN albums album ON album.id = member.album_id AND album.deleted_at IS NULL
        JOIN materials material ON material.id = member.target_id
          AND material.kind IN ('IMAGE', 'VIDEO') AND material.deleted_at IS NULL
        JOIN image_assets asset ON asset.id = material.image_asset_id AND asset.deleted_at IS NULL
        WHERE member.target_type = 'MATERIAL' AND member.deleted_at IS NULL
        UNION
        SELECT member.album_id, run.result_asset_id AS asset_id
        FROM album_members member
        JOIN albums album ON album.id = member.album_id AND album.deleted_at IS NULL
        JOIN prompt_series series ON series.id = member.target_id AND series.deleted_at IS NULL
        JOIN prompt_versions version ON version.series_id = series.id
        JOIN generation_runs run ON run.prompt_version_id = version.id
        JOIN image_assets asset ON asset.id = run.result_asset_id AND asset.deleted_at IS NULL
        WHERE member.target_type = 'SERIES' AND member.deleted_at IS NULL
          AND run.status = 'SUCCEEDED'
          AND NOT EXISTS (
            SELECT 1 FROM prompt_series_output_exclusions exclusion
            WHERE exclusion.series_id = series.id AND exclusion.image_asset_id = run.result_asset_id
          )
        UNION
        SELECT member.album_id, imported.image_asset_id AS asset_id
        FROM album_members member
        JOIN albums album ON album.id = member.album_id AND album.deleted_at IS NULL
        JOIN prompt_series series ON series.id = member.target_id AND series.deleted_at IS NULL
        JOIN creation_output_imports imported ON imported.series_id = series.id
          AND imported.deleted_at IS NULL
        JOIN image_assets asset ON asset.id = imported.image_asset_id AND asset.deleted_at IS NULL
        WHERE member.target_type = 'SERIES' AND member.deleted_at IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM prompt_series_output_exclusions exclusion
            WHERE exclusion.series_id = series.id AND exclusion.image_asset_id = imported.image_asset_id
          )
        UNION
        SELECT member.album_id, transform.output_asset_id AS asset_id
        FROM album_members member
        JOIN albums album ON album.id = member.album_id AND album.deleted_at IS NULL
        JOIN prompt_series series ON series.id = member.target_id AND series.deleted_at IS NULL
        JOIN image_transform_runs transform ON transform.series_id = series.id
          AND transform.deleted_at IS NULL
        JOIN image_assets asset ON asset.id = transform.output_asset_id AND asset.deleted_at IS NULL
        WHERE member.target_type = 'SERIES' AND member.deleted_at IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM prompt_series_output_exclusions exclusion
            WHERE exclusion.series_id = series.id AND exclusion.image_asset_id = transform.output_asset_id
          )
        UNION
        SELECT member.album_id, binding.image_asset_id AS asset_id
        FROM album_members member
        JOIN albums album ON album.id = member.album_id AND album.deleted_at IS NULL
        JOIN prompt_series series ON series.id = member.target_id AND series.deleted_at IS NULL
        JOIN prompt_versions version ON version.series_id = series.id
        JOIN reference_bindings binding ON binding.prompt_version_id = version.id
        JOIN image_assets asset ON asset.id = binding.image_asset_id AND asset.deleted_at IS NULL
        WHERE member.target_type = 'SERIES' AND member.deleted_at IS NULL
        ORDER BY album_id, asset_id`,
      )
      .all() as JsonMap[];
    for (const row of rows) {
      const albumId = text(row.album_id);
      const assetId = text(row.asset_id);
      const directoryPath = albumDirectories.get(albumId);
      const asset = assets.get(assetId);
      if (!directoryPath || !asset) continue;
      const key = linkKey(assetId, albumId);
      desired.set(key, {
        key,
        asset,
        directoryPath,
        preferredName: this.preferredAssetName(asset),
        contextType: 'ALBUM',
        contextId: albumId,
        directoryKey: directoryKey('ALBUM', albumId),
        allocationOrder: 0,
      });
    }

    const termsById = new Map(terms.map((term) => [term.id, term]));
    const termMediaRows = this.db
      .prepare(
        `SELECT media.term_id, media.image_asset_id AS asset_id,
          media.role, media.sort_order, media.created_at
        FROM term_media_links media
        JOIN terms term ON term.id = media.term_id
        JOIN image_assets asset ON asset.id = media.image_asset_id AND asset.deleted_at IS NULL
        WHERE media.deleted_at IS NULL
        ORDER BY media.term_id,
          CASE media.role WHEN 'COVER' THEN 0 ELSE 1 END,
          media.sort_order, media.created_at, media.id`,
      )
      .all() as JsonMap[];
    for (const row of termMediaRows) {
      const termId = text(row.term_id);
      const assetId = text(row.asset_id);
      const term = termsById.get(termId);
      const directoryPath = termDirectories.get(termId);
      const asset = assets.get(assetId);
      if (!term || !directoryPath || !asset) continue;
      const key = termLinkKey(assetId, termId);
      const preferredName = safeAssetFileName(`${term.name}${asset.extension}`, '词条图片', asset.extension);
      desired.set(key, {
        key,
        asset,
        directoryPath,
        preferredName,
        contextType: 'TERM',
        contextId: termId,
        directoryKey: directoryKey('TERM', termId),
        allocationOrder: (text(row.role) === 'COVER' ? 0 : 1_000_000) + Number(row.sort_order),
      });
    }
    for (const entry of desired.values()) this.assertInside(root, entry.directoryPath);
    return desired;
  }

  protected reconcileLinks(root: string, desired: Map<string, DesiredLink>, previousLinks: IndexedLink[]) {
    const previousByKey = this.indexPreviousLinks(previousLinks);
    const safePreviousPaths = this.safePreviousLinkPaths(root, previousLinks);
    const preservedPaths = this.preservedLinkPaths(root, desired, previousByKey);
    this.retireStaleLinks(root, safePreviousPaths, preservedPaths);

    const nextLinks: IndexedLink[] = [];
    for (const group of this.groupDesiredLinks(desired).values()) {
      nextLinks.push(...this.reconcileLinkGroup(root, group, previousByKey));
    }
    return nextLinks;
  }

  private indexPreviousLinks(previousLinks: IndexedLink[]) {
    const previousByKey = new Map<string, IndexedLink>();
    for (const entry of previousLinks) {
      const current = previousByKey.get(entry.key);
      if (!current || (entry.preferredName && !current.preferredName)) previousByKey.set(entry.key, entry);
    }
    return previousByKey;
  }

  private safePreviousLinkPaths(root: string, previousLinks: IndexedLink[]) {
    const safePaths = new Map<string, IndexedLink>();
    for (const entry of previousLinks) {
      if (entry.state === 'RETIRED') continue;
      const sourcePath = this.sourcePathForRecord(root, entry);
      if (!sourcePath) continue;
      const managedPath = this.absoluteManagedPath(root, entry.relativePath);
      if (sameFile(sourcePath, managedPath)) safePaths.set(this.absolutePathKey(managedPath), entry);
    }
    return safePaths;
  }

  private preservedLinkPaths(root: string, desired: Map<string, DesiredLink>, previousByKey: Map<string, IndexedLink>) {
    const preservedPaths = new Set<string>();
    for (const [key, entry] of desired) {
      const previous = previousByKey.get(key);
      if (!previous || previous.preferredName !== entry.preferredName) continue;
      const previousPath = this.absoluteManagedPath(root, previous.relativePath);
      const previousName = path.basename(previousPath);
      if (this.canPreserveLink(previousPath, previousName, entry)) {
        preservedPaths.add(this.absolutePathKey(previousPath));
      }
    }
    return preservedPaths;
  }

  private canPreserveLink(previousPath: string, previousName: string, entry: DesiredLink) {
    return (
      this.absolutePathKey(path.dirname(previousPath)) === this.absolutePathKey(entry.directoryPath) &&
      isNumberedFileName(previousName, entry.preferredName) &&
      sameFile(entry.asset.absolutePath, previousPath)
    );
  }

  private retireStaleLinks(root: string, safePaths: Map<string, IndexedLink>, preservedPaths: Set<string>) {
    for (const [pathKey, previous] of safePaths) {
      if (preservedPaths.has(pathKey)) continue;
      this.updateLinkState(previous.key, 'PENDING_DELETE');
      try {
        unlinkSync(this.absoluteManagedPath(root, previous.relativePath));
        this.updateLinkState(previous.key, 'RETIRED');
      } catch (error) {
        if (nodeErrorCode(error) === 'ENOENT') {
          this.updateLinkState(previous.key, 'RETIRED');
          continue;
        }
        this.updateLinkState(previous.key, 'ERROR', error);
        throw error;
      }
    }
  }

  private groupDesiredLinks(desired: Map<string, DesiredLink>) {
    const groups = new Map<string, DesiredLink[]>();
    for (const entry of desired.values()) {
      const key = this.absolutePathKey(entry.directoryPath);
      const group = groups.get(key) ?? [];
      group.push(entry);
      groups.set(key, group);
    }
    return groups;
  }

  private reconcileLinkGroup(
    root: string,
    group: DesiredLink[],
    previousByKey: Map<string, IndexedLink>,
  ): IndexedLink[] {
    const directoryPath = group[0].directoryPath;
    const claimed = new Set(readdirSync(directoryPath).map((name) => collisionKey(name)));
    group.sort((left, right) => this.compareDesiredLinks(left, right, previousByKey));
    const links: IndexedLink[] = [];
    for (const entry of group) {
      links.push(this.reconcileDesiredLink(root, directoryPath, entry, previousByKey.get(entry.key), claimed));
    }
    return links;
  }

  private compareDesiredLinks(left: DesiredLink, right: DesiredLink, previousByKey: Map<string, IndexedLink>) {
    const leftStable = previousByKey.get(left.key)?.preferredName === left.preferredName ? 0 : 1;
    const rightStable = previousByKey.get(right.key)?.preferredName === right.preferredName ? 0 : 1;
    return (
      leftStable - rightStable ||
      left.allocationOrder - right.allocationOrder ||
      left.asset.assetId.localeCompare(right.asset.assetId)
    );
  }

  private reconcileDesiredLink(
    root: string,
    directoryPath: string,
    entry: DesiredLink,
    previous: IndexedLink | undefined,
    claimed: Set<string>,
  ) {
    let selectedName = this.reusableLinkName(root, directoryPath, entry, previous, claimed);
    selectedName ||= this.availableLinkName(entry.preferredName, claimed);
    if (!selectedName) throw new Error(`Unable to allocate a filename for asset ${entry.asset.assetId}`);

    let destination = path.resolve(directoryPath, selectedName);
    this.assertInside(root, destination);
    ensureReadOnly(entry.asset.absolutePath);
    if (!existsSync(destination)) {
      this.createManagedLink(root, entry, destination);
    } else if (!sameFile(entry.asset.absolutePath, destination)) {
      ({ selectedName, destination } = this.createAlternateManagedLink(
        root,
        directoryPath,
        entry,
        selectedName,
        claimed,
      ));
    }
    claimed.add(collisionKey(selectedName));
    return this.indexedLink(root, entry, destination);
  }

  private reusableLinkName(
    root: string,
    directoryPath: string,
    entry: DesiredLink,
    previous: IndexedLink | undefined,
    claimed: Set<string>,
  ) {
    if (previous?.preferredName !== entry.preferredName) return '';
    const previousName = path.basename(this.absoluteManagedPath(root, previous.relativePath));
    if (!isNumberedFileName(previousName, entry.preferredName)) return '';
    const previousPath = path.resolve(directoryPath, previousName);
    if (sameFile(entry.asset.absolutePath, previousPath)) claimed.delete(collisionKey(previousName));
    return claimed.has(collisionKey(previousName)) ? '' : previousName;
  }

  private availableLinkName(preferredName: string, claimed: Set<string>) {
    for (let attempt = 1; attempt <= maximumConflictAttempts; attempt += 1) {
      const candidate = numberedFileName(preferredName, attempt);
      if (!claimed.has(collisionKey(candidate))) return candidate;
    }
    return '';
  }

  private createManagedLink(root: string, entry: DesiredLink, destination: string) {
    this.persistPendingLink(root, entry, destination);
    try {
      linkSync(entry.asset.absolutePath, destination);
      this.updateLinkState(entry.key, 'ACTIVE');
    } catch (error) {
      if (nodeErrorCode(error) === 'EEXIST' && sameFile(entry.asset.absolutePath, destination)) {
        this.updateLinkState(entry.key, 'ACTIVE');
        return;
      }
      this.failManagedLinkCreation(entry, error);
    }
  }

  private failManagedLinkCreation(entry: DesiredLink, error: unknown): never {
    this.updateLinkState(entry.key, 'ERROR', error);
    const code = nodeErrorCode(error);
    if (code === 'EXDEV' || code === 'EPERM' || code === 'ENOTSUP') {
      throw new Error('This library location does not support the hard links required by managed folders', {
        cause: error,
      });
    }
    throw error;
  }

  private createAlternateManagedLink(
    root: string,
    directoryPath: string,
    entry: DesiredLink,
    selectedName: string,
    claimed: Set<string>,
  ) {
    // A concurrent external write claimed the planned path. Re-run the
    // allocator with that name reserved instead of replacing it.
    claimed.add(collisionKey(selectedName));
    for (let attempt = 1; attempt <= maximumConflictAttempts; attempt += 1) {
      const candidate = numberedFileName(entry.preferredName, attempt);
      const destination = path.resolve(directoryPath, candidate);
      if (claimed.has(collisionKey(candidate)) || existsSync(destination)) continue;
      this.persistPendingLink(root, entry, destination);
      try {
        linkSync(entry.asset.absolutePath, destination);
        this.updateLinkState(entry.key, 'ACTIVE');
        return { selectedName: candidate, destination };
      } catch (error) {
        this.updateLinkState(entry.key, 'ERROR', error);
        throw error;
      }
    }
    throw new Error(`Unable to allocate a filename for asset ${entry.asset.assetId}`);
  }

  private indexedLink(root: string, entry: DesiredLink, destination: string): IndexedLink {
    return {
      key: entry.key,
      contextType: entry.contextType,
      contextId: entry.contextId,
      directoryKey: entry.directoryKey,
      state: 'ACTIVE',
      assetId: entry.asset.assetId,
      relativePath: this.relativeManagedPath(root, destination),
      sourceRelativePath: this.relativeSafePath(root, entry.asset.absolutePath),
      sourceObjectHash: entry.asset.objectHash,
      preferredName: entry.preferredName,
    };
  }

  protected removeEmptyManagedDirectories(
    root: string,
    previousDirectories: IndexedDirectory[],
    currentDirectories: IndexedDirectory[],
  ) {
    const desired = new Set(
      currentDirectories.map((entry) => this.absolutePathKey(this.absoluteManagedPath(root, entry.relativePath))),
    );
    const candidates = [
      ...new Set(
        previousDirectories
          .filter((entry) => entry.state !== 'RETIRED')
          .map((entry) => this.absoluteManagedPath(root, entry.relativePath)),
      ),
    ].sort((left, right) => right.split(path.sep).length - left.split(path.sep).length);
    for (const candidate of candidates) {
      if (desired.has(this.absolutePathKey(candidate)) || !existsSync(candidate)) continue;
      try {
        const entry = lstatSync(candidate);
        if (!entry.isSymbolicLink() && entry.isDirectory()) rmdirSync(candidate);
      } catch (error) {
        const code = nodeErrorCode(error);
        if (code !== 'ENOENT' && code !== 'ENOTEMPTY' && code !== 'EEXIST') throw error;
      }
    }
  }
}
