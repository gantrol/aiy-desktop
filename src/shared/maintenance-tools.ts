import type { MaintenanceProject, MaintenanceToolId } from '@/shared/contracts/maintenance-guide';

export const maintenanceToolGroups = ['operations', 'seo', 'trends', 'maintenance'] as const;
export const maintenanceTools: readonly {
  id: MaintenanceToolId;
  group: (typeof maintenanceToolGroups)[number];
  url: string;
}[] = [
  { id: 'searchConsole', group: 'operations', url: 'https://search.google.com/search-console' },
  { id: 'analytics', group: 'operations', url: 'https://analytics.google.com/' },
  { id: 'ads', group: 'operations', url: 'https://ads.google.com/' },
  { id: 'ahrefs', group: 'seo', url: 'https://ahrefs.com/webmaster-tools' },
  { id: 'semrush', group: 'seo', url: 'https://www.semrush.com/' },
  { id: 'bing', group: 'seo', url: 'https://www.bing.com/webmasters/' },
  { id: 'pagespeed', group: 'seo', url: 'https://pagespeed.web.dev/' },
  { id: 'similarweb', group: 'seo', url: 'https://www.similarweb.com/' },
  { id: 'trends', group: 'trends', url: 'https://trends.google.com/trends/' },
  { id: 'baidu', group: 'trends', url: 'https://index.baidu.com/' },
  { id: 'explodingTopics', group: 'trends', url: 'https://explodingtopics.com/' },
  { id: 'githubActions', group: 'maintenance', url: 'https://github.com/features/actions' },
  { id: 'cloudflare', group: 'maintenance', url: 'https://dash.cloudflare.com/' },
  { id: 'sentry', group: 'maintenance', url: 'https://sentry.io/' },
  { id: 'uptimeKuma', group: 'maintenance', url: 'https://uptimekuma.org/' },
  { id: 'healthchecks', group: 'maintenance', url: 'https://healthchecks.io/' },
];

export function maintenanceToolUrl(project: MaintenanceProject, toolId: MaintenanceToolId): string | null {
  if (toolId === 'ads' && !project.adsEnabled) return null;
  const custom = project.toolUrls[toolId];
  if (custom) return custom;
  const tool = maintenanceTools.find((item) => item.id === toolId);
  if (!tool) return null;
  const url = new URL(tool.url);
  if (toolId === 'pagespeed' && project.website) url.searchParams.set('url', project.website);
  return url.href;
}
