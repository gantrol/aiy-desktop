import type { ExtensionRegistry } from '@/main/extensions/registry';
import { EXTENSION_PERMISSION } from '@/shared/extension-permissions';
import { contentApplicationCommandSchema, type ContentApplication } from '@/shared/contracts/content-applications';

/** Host adapters validate their own commands; manifests cannot supply executable UI or IPC names. */
export interface ContentApplicationAdapter {
  id: string;
  extensionId: string;
  name: string;
  requiredPermissions: readonly string[];
  configurationCommands?: readonly string[];
  execute(command: unknown): Promise<unknown>;
  openSettings(): Promise<unknown>;
}

export class ContentApplicationRegistry {
  private readonly adapters = new Map<string, ContentApplicationAdapter>();
  constructor(private readonly extensions: ExtensionRegistry) {}
  register(adapter: ContentApplicationAdapter) {
    if (this.adapters.has(adapter.id)) throw new Error('Duplicate content application');
    this.adapters.set(adapter.id, adapter);
    return this;
  }
  list(): ContentApplication[] {
    const extensions = new Map(this.extensions.list().map((extension) => [extension.manifest.id, extension]));
    return [...this.adapters.values()].flatMap((adapter) => {
      const extension = extensions.get(adapter.extensionId);
      if (!extension?.manifest.contributes.contentApplications?.includes(adapter.id)) return [];
      const permissions = [EXTENSION_PERMISSION.libraryReadSelectedContent, ...adapter.requiredPermissions];
      const missingPermissions = [...new Set(permissions)].filter(
        (permission) => !this.extensions.isPermissionGranted(adapter.extensionId, permission),
      );
      return [
        {
          id: adapter.id,
          extensionId: adapter.extensionId,
          name: adapter.name,
          enabled: extension.enabled && extension.compatible,
          available: this.extensions.isActivated(adapter.extensionId) && !missingPermissions.length,
          missingPermissions,
        },
      ];
    });
  }
  async execute(input: unknown) {
    const request = contentApplicationCommandSchema.parse(input);
    const adapter = this.adapters.get(request.applicationId);
    const application = this.list().find((item) => item.id === request.applicationId);
    if (!adapter || !application) throw new Error('[aiy-petal:sourceUnavailable]');
    // Opening the plugin's permission page does not grant it access to content.
    if (request.command.kind === 'open-settings') return adapter.openSettings();
    if (adapter.configurationCommands?.includes(request.command.kind)) return adapter.execute(request.command);
    if (!application.available) throw new Error('[aiy-content-application:permission]');
    return adapter.execute(request.command);
  }
}
