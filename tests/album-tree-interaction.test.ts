import { describe, expect, it, vi } from 'vitest';
import {
  ALBUM_TREE_INTERACTION,
  hasAlbumTreeVerticalTravel,
  shouldExpandAlbumFromPullDown,
  trackAlbumTreeRetreat,
} from '../src/renderer/components/albums/albumTreeInteraction';
import { createAlbumExpansionAction } from '../src/renderer/components/albums/albumTreeMenuActions';
import {
  getTreeBranchItemTopology,
  getTreeBranchNodeConnectorPath,
  getTreeDisclosurePath,
  getTreeNodeAnchor,
  TREE_CONNECTION_GEOMETRY,
  treeBranchRailContinues,
} from '../src/renderer/components/albums/treeConnectionGeometry';

describe('album tree interaction policy', () => {
  it('uses one deliberate travel threshold in both directions', () => {
    expect(ALBUM_TREE_INTERACTION.verticalGestureDistancePx).toBe(27);
    expect(hasAlbumTreeVerticalTravel(100, 74, 'up')).toBe(false);
    expect(hasAlbumTreeVerticalTravel(100, 73, 'up')).toBe(true);
    expect(hasAlbumTreeVerticalTravel(100, 126, 'down')).toBe(false);
    expect(hasAlbumTreeVerticalTravel(100, 127, 'down')).toBe(true);
  });

  it('does not accept pull-down while the pointer is merely passing through', () => {
    expect(
      shouldExpandAlbumFromPullDown({
        armed: false,
        originY: 100,
        currentY: 127,
      }),
    ).toBe(false);
    expect(
      shouldExpandAlbumFromPullDown({
        armed: true,
        originY: 100,
        currentY: 127,
      }),
    ).toBe(true);
  });

  it('resets at the retreat point so pull-down and retreat can repeat', () => {
    const firstPullDown = shouldExpandAlbumFromPullDown({
      armed: true,
      originY: 100,
      currentY: 127,
    });
    const retreat = trackAlbumTreeRetreat(127, 100);
    const secondPullDown = shouldExpandAlbumFromPullDown({
      armed: true,
      originY: retreat.originY,
      currentY: 127,
    });

    expect(firstPullDown).toBe(true);
    expect(retreat).toEqual({ retreated: true, originY: 100 });
    expect(secondPullDown).toBe(true);
  });

  it('builds an expansion action that reflects and toggles the current state', () => {
    const onExpandedChange = vi.fn();
    const expand = createAlbumExpansionAction({
      expanded: false,
      expandLabel: 'Expand album',
      collapseLabel: 'Collapse album',
      onExpandedChange,
    });
    expect(expand).toMatchObject({ id: 'expand', label: 'Expand album' });
    expand.onSelect();
    expect(onExpandedChange).toHaveBeenLastCalledWith(true);

    const collapse = createAlbumExpansionAction({
      expanded: true,
      expandLabel: 'Expand album',
      collapseLabel: 'Collapse album',
      onExpandedChange,
    });
    expect(collapse).toMatchObject({ id: 'collapse', label: 'Collapse album' });
    collapse.onSelect();
    expect(onExpandedChange).toHaveBeenLastCalledWith(false);
  });

  it('joins disclosure and branch rails through stable shared ports', () => {
    const anchor = getTreeNodeAnchor({ left: 24, top: 0, right: 64, bottom: 60 });
    const continuing = getTreeBranchItemTopology(0, 2);
    const terminal = getTreeBranchItemTopology(1, 2);

    const disclosureOutlet = new RegExp(
      `${TREE_CONNECTION_GEOMETRY.parentOutletX} (?:-?\\d+(?:\\.\\d+)?V)?${TREE_CONNECTION_GEOMETRY.disclosureConnectorEndY}$`,
    );
    expect(getTreeDisclosurePath(anchor, true)).toMatch(disclosureOutlet);
    expect(getTreeDisclosurePath(anchor, false)).not.toMatch(disclosureOutlet);
    expect(getTreeBranchNodeConnectorPath(continuing, anchor)).toMatch(/^M-12 /);
    expect(getTreeBranchNodeConnectorPath(terminal, anchor)).toMatch(/^M-12 0V/);
    expect(treeBranchRailContinues(continuing)).toBe(true);
    expect(treeBranchRailContinues(terminal)).toBe(false);
  });
});
