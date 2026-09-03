# Renderer stacking layers

The renderer uses two separate z-index scales.

## Component stacking islands

Components should create an `isolate` boundary when their internal media, controls, and transient UI overlap. Inside that boundary, use numeric utilities only from `z-0` through `z-40`:

| Range | Purpose                                                |
| ----- | ------------------------------------------------------ |
| `0`   | Background                                             |
| `10`  | Content                                                |
| `20`  | Controls                                               |
| `30`  | Local transient UI                                     |
| `40`  | Local top layer, including drag and resize affordances |

These numbers are local implementation details. They must not be increased to compete with a Portal or another feature.

## Global layers

Global layers use semantic Tailwind utilities declared in `styles/tokens.css`:

| Utility          | Value | Purpose                                        |
| ---------------- | ----: | ---------------------------------------------- |
| `z-chrome`       |    50 | Persistent application controls                |
| `z-popup`        |    60 | Popover, Select, DropdownMenu, and ContextMenu |
| `z-tooltip`      |    70 | Tooltip and HoverCard                          |
| `z-drag`         |    75 | Window-level drag feedback                     |
| `z-modal-scrim`  |    80 | Modal interaction barrier                      |
| `z-modal`        |    90 | Dialog and modal Sheet surfaces                |
| `z-modal-nested` |   100 | Portal root owned by the nearest modal         |
| `z-toast`        |   110 | Notifications                                  |
| `z-takeover`     |   120 | Blocking workspace transitions                 |
| `z-fullscreen`   |   130 | Fullscreen fallback surfaces                   |

Do not introduce arbitrary global z-index values. Add or change a semantic layer only when the product interaction order changes.

## Portal ownership

All interactive Portal surfaces carry `data-overlay-surface`. Dialog and Sheet create a modal overlay scope, and nested Popover, Select, DropdownMenu, ContextMenu, Tooltip, HoverCard, Dialog, and Sheet portals mount into the nearest scope. This keeps a modal's transient UI above its surface without raising every popup above every modal.

The generic surface marker is also the outside-interaction contract. Modal components must not maintain component-name selector lists.

Dialog and Sheet are window-modal interactions: their scrims block the title bar. A Sheet's top spacing is a panel-layout choice and does not make the title bar interactive. Workspace-only overlays must be owned by a workspace container instead of reusing the modal primitives.
