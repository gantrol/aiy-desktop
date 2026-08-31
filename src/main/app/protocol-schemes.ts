import { protocol } from 'electron';
import { CODEX_VISUALIZATION_PREVIEW_SCHEME } from '@/main/app/codex-visualization-preview-policy';
import { RENDERER_SCHEME } from '@/main/app/renderer-protocol';

export function registerApplicationSchemes() {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: RENDERER_SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true, codeCache: true },
    },
    {
      scheme: 'aiy-media',
      privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true },
    },
    {
      scheme: CODEX_VISUALIZATION_PREVIEW_SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
    },
  ]);
}
