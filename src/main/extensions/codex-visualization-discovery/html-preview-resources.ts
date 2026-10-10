interface ResourcePolicy {
  contentType: string;
  maximumBytes: number;
}

const staticResources: Readonly<Record<string, ResourcePolicy | undefined>> = {
  '.html': { contentType: 'text/html; charset=utf-8', maximumBytes: 4 * 1024 * 1024 },
  '.htm': { contentType: 'text/html; charset=utf-8', maximumBytes: 4 * 1024 * 1024 },
  '.css': { contentType: 'text/css; charset=utf-8', maximumBytes: 2 * 1024 * 1024 },
  '.png': { contentType: 'image/png', maximumBytes: 8 * 1024 * 1024 },
  '.jpg': { contentType: 'image/jpeg', maximumBytes: 8 * 1024 * 1024 },
  '.jpeg': { contentType: 'image/jpeg', maximumBytes: 8 * 1024 * 1024 },
  '.webp': { contentType: 'image/webp', maximumBytes: 8 * 1024 * 1024 },
};

const executableResources: typeof staticResources = {
  '.js': { contentType: 'text/javascript; charset=utf-8', maximumBytes: 2 * 1024 * 1024 },
  '.mjs': { contentType: 'text/javascript; charset=utf-8', maximumBytes: 2 * 1024 * 1024 },
};

export function htmlPreviewResourcePolicy(extension: string, scriptsAllowed = false) {
  return staticResources[extension] ?? (scriptsAllowed ? executableResources[extension] : undefined);
}
