import { useMemo, type ReactNode } from 'react';
import { ContentLinkProviders } from '@/renderer/features/content-editor/ContentLinkProviders';
import { useCodexLinkProvider } from '@/renderer/features/extensions/codex-content/codex-link-provider';
import type { ContentApplication } from '@/shared/contracts/content-applications';
import type { ExtensionDto } from '@/shared/contracts';

/** Renderer contributions use the host's existing extension snapshot, without extra discovery requests. */
export function ExtensionContentLinks({
  applications,
  extensions,
  children,
}: {
  applications?: readonly ContentApplication[];
  extensions?: readonly ExtensionDto[];
  children: ReactNode;
}) {
  const codex = useCodexLinkProvider();
  const providers = useMemo(
    () =>
      [codex].filter(
        (provider) =>
          applications?.some((application) => application.id === provider.id && application.enabled) ||
          extensions?.some(
            (extension) =>
              extension.enabled &&
              extension.compatible &&
              extension.manifest.contributes.contentApplications?.includes(provider.id),
          ),
      ),
    [applications, extensions, codex],
  );
  return <ContentLinkProviders.Provider value={providers}>{children}</ContentLinkProviders.Provider>;
}
