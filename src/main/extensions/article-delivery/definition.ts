import type { ExtensionArticleDeliveryConfigurationDto } from '@/shared/contracts';
import type { ExtensionRegistry } from '@/main/extensions/registry';
import type { ArticleDeliveryExtensionTarget } from '@/shared/contracts/article-delivery';
import { ARTICLE_DELIVERY_HOST_RUNTIME_ID } from '@/main/extensions/host-runtime-contracts';
import { EXTENSION_HOST_ENGINE_KEY, EXTENSION_HOST_VERSION } from '@/shared/product';

export interface ArticleDeliveryDefinition extends ArticleDeliveryExtensionTarget {
  configuration: ExtensionArticleDeliveryConfigurationDto;
  credentialPermission: string;
}

export function assertArticleDeliveryExtensionActivated(
  extensions: Pick<ExtensionRegistry, 'get' | 'isActivated'>,
  extensionId: string,
) {
  const extension = extensions.get(extensionId);
  if (!extension) throw new Error('Article delivery extension is unavailable');
  if (!extension.enabled) throw new Error('Article delivery extension is disabled');
  if (!extension.compatible) {
    throw new Error(
      `Article delivery extension requires AIY ${extension.manifest.engines[EXTENSION_HOST_ENGINE_KEY]}; ` +
        `the current extension host is ${EXTENSION_HOST_VERSION}`,
    );
  }
  const missingPermissions = extension.permissions
    .filter((permission) => permission.required && !permission.granted)
    .map((permission) => permission.key);
  if (missingPermissions.length) {
    throw new Error(`Article delivery extension requires permission: ${missingPermissions.join(', ')}`);
  }
  if (!extensions.isActivated(extensionId)) throw new Error('Article delivery extension is unavailable');
}

export function resolveArticleDeliveryDefinition(
  extensions: Pick<ExtensionRegistry, 'get'>,
  target: ArticleDeliveryExtensionTarget,
): ArticleDeliveryDefinition {
  const extension = extensions.get(target.extensionId);
  const configuration = extension?.manifest.configuration;
  if (
    !extension ||
    extension.manifest.runtime?.id !== ARTICLE_DELIVERY_HOST_RUNTIME_ID ||
    configuration?.kind !== 'ARTICLE_DELIVERY' ||
    !extension.manifest.contributes.deliveryChannels?.includes(target.channelId)
  ) {
    throw new Error('Article delivery extension is unavailable');
  }
  const credentialPermissions = extension.manifest.permissions.filter((permission) =>
    permission.startsWith('credentials.use:'),
  );
  if (credentialPermissions.length !== 1) throw new Error('Article delivery credential contract is invalid');
  return {
    ...target,
    configuration,
    credentialPermission: credentialPermissions[0]!,
  };
}
