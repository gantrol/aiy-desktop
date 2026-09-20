import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'wxt';

declare const process: { env: Record<string, string | undefined> };

const defaultLoopbackPort = 47_831;

function browserCompanionLoopbackPort(): number {
  if (process.env.AIY_E2E !== '1') return defaultLoopbackPort;
  const configured = process.env.AIY_BROWSER_COMPANION_LOOPBACK_PORT?.trim();
  if (!configured) return defaultLoopbackPort;
  if (!/^\d{4,5}$/.test(configured)) {
    throw new Error('Invalid browser companion E2E loopback port');
  }
  const port = Number(configured);
  if (!Number.isSafeInteger(port) || port < 1_024 || port > 65_535) {
    throw new Error('Invalid browser companion E2E loopback port');
  }
  return port;
}

function workspaceIdentity(value: string): string {
  let first = 2_166_136_261;
  let second = 3_332_006_535;
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    first = Math.imul(first ^ code, 16_777_619);
    second = Math.imul(second ^ code, 2_246_822_519);
  }
  return [first, second].map((part) => (part >>> 0).toString(16).padStart(8, '0')).join('');
}

let developmentBuildReadyAt = Number.POSITIVE_INFINITY;
const developmentWorkspaceId = workspaceIdentity(new URL('.', import.meta.url).href.toLowerCase());
const supportedMatches = [
  'https://chatgpt.com/*',
  'https://mp.weixin.qq.com/*',
  'https://weibo.com/*',
  'https://www.weibo.com/*',
  'https://x.com/*',
  'https://twitter.com/*',
  'https://creator.xiaohongshu.com/*',
] as const;
const companionPermissions = ['activeTab', 'storage', 'scripting'] as const;
const companionHostPermissions = [...supportedMatches, 'http://127.0.0.1/*'] as const;

export default defineConfig({
  srcDir: 'src',
  outDirTemplate: '{{browser}}-mv{{manifestVersion}}{{modeSuffix}}',
  modules: ['@wxt-dev/module-react'],
  dev: {
    server: {
      host: '127.0.0.1',
      origin: 'http://127.0.0.1:3017',
      port: 3017,
      strictPort: true,
    },
  },
  webExt: { disabled: true },
  manifest: {
    name: '__MSG_extensionName__',
    description: '__MSG_extensionDescription__',
    default_locale: 'en',
    version: '0.0.6',
    key: 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAr+eynucctrHD6gDJvWZCSyzvIvCuJkt+U7xZZqrs380WNovxaShRZ/CvVlRwKliW7I8Z2KfvABpmAvAc7Mvb8+eC+SntwpF/4TiEyoK5KM2Q0JF9KUoVt3PVPlaSi9G/PqkWHzAjqYWO+zB6zO0f2sC2I56hCN0kcrgDT/iVjbSdl8SKwWbdMl9+niD56Mb4a8zI8WHUmwU6KWmq/SmCEk9xtL5dGw4RDpVz20g+rvr6Cs+wJfrkxaIadQDvoR825lByJ/EYR/N3j3ePFQdxfSy7ubux/yGsGCcAV/JSKxt9jts53+PwW5zwym7FckQqGjysSeKOz7n1xevBWd0JSwIDAQAB',
    permissions: [...companionPermissions],
    optional_permissions: ['tabGroups'],
    host_permissions: [...companionHostPermissions],
    externally_connectable: {
      matches: ['http://127.0.0.1/*'],
    },
    icons: {
      16: 'icons/icon-16.png',
      32: 'icons/icon-32.png',
      48: 'icons/icon-48.png',
      128: 'icons/icon-128.png',
    },
    action: {
      default_title: '__MSG_extensionName__',
      default_icon: {
        16: 'icons/icon-16.png',
        32: 'icons/icon-32.png',
      },
    },
  },
  vite: () => ({
    define: {
      __AIY_BROWSER_COMPANION_LOOPBACK_PORT__: JSON.stringify(browserCompanionLoopbackPort()),
    },
    plugins: [
      tailwindcss(),
      {
        name: 'aiy-companion-dev-identity',
        buildStart() {
          developmentBuildReadyAt = Number.POSITIVE_INFINITY;
        },
        closeBundle() {
          developmentBuildReadyAt = Date.now() + 250;
        },
        configureServer(server) {
          server.middlewares.use('/__aiy_companion_dev', (_request, response) => {
            response.setHeader('Content-Type', 'application/json');
            if (Date.now() < developmentBuildReadyAt) {
              response.statusCode = 503;
              response.end(
                JSON.stringify({
                  id: 'aiy-browser-companion-dev',
                  protocolVersion: 1,
                  mode: 'development',
                  workspaceId: developmentWorkspaceId,
                  status: 'building',
                }),
              );
              return;
            }
            response.end(
              JSON.stringify({
                id: 'aiy-browser-companion-dev',
                protocolVersion: 1,
                mode: 'development',
                workspaceId: developmentWorkspaceId,
              }),
            );
          });
        },
      },
    ],
  }),
});
