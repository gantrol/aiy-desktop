import type { Plugin, PluginOption } from 'vite';

export async function offlineDevelopmentHtmlPlugins(options: readonly PluginOption[]): Promise<Plugin[]> {
  const plugins: Plugin[] = [];
  for (const option of options) {
    const plugin = await option;
    if (!plugin) continue;
    if (Array.isArray(plugin)) {
      plugins.push(...(await offlineDevelopmentHtmlPlugins(plugin)));
      continue;
    }
    // WXT 0.21's dev HTML points to Vite modules instead of bundled files.
    // Retain its local reload-module alias while removing remote HTML transforms.
    if (plugin.name === 'wxt:virtualize-inline-scripts') continue;
    if (plugin.name === 'wxt:dev-html-prerender') {
      plugins.push({ ...plugin, transform: undefined, transformIndexHtml: undefined });
      continue;
    }
    plugins.push(
      plugin.name === 'wxt:plugin-loader'
        ? {
            ...plugin,
            transformIndexHtml: {
              order: 'pre',
              handler: (html) =>
                html.replace(
                  /<head(\s[^>]*)?>/i,
                  '$&<script type="module" src="virtual:wxt-html-plugins"></script>' +
                    '<script type="module" src="@wxt/reload-html"></script>',
                ),
            },
          }
        : plugin,
    );
  }
  return plugins;
}
