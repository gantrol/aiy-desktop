import path from 'node:path';
import { defineConfig } from 'vitest/config';

export type TestEnvironment = 'node' | 'jsdom';

interface TestProjectSelection {
  name: string;
  include: string[];
  exclude?: string[];
  environment?: TestEnvironment;
  setupFiles?: string[];
}

type CoverageMetricThresholds = Partial<Record<'lines' | 'statements' | 'functions' | 'branches', number>>;

interface CoverageThresholds {
  lines: number;
  statements: number;
  functions: number;
  branches: number;
  [glob: string]: number | CoverageMetricThresholds;
}

interface TestSelection {
  include?: string[];
  exclude?: string[];
  environment?: TestEnvironment;
  setupFiles?: string[];
  projects?: TestProjectSelection[];
  coverageThresholds?: CoverageThresholds;
}

/**
 * Installed for every lane. The outbound circuit breaker is not opt-in: no test
 * configuration may reach a paid provider, so it is wired here instead of in
 * individual suites.
 */
const mandatorySetupFiles = [path.resolve(__dirname, 'tests/support/network-guard.ts')];

export function createVitestConfig({
  include,
  exclude = [],
  environment = 'node',
  setupFiles = [],
  projects,
  coverageThresholds,
}: TestSelection) {
  return defineConfig({
    resolve: {
      alias: { '@': path.resolve(__dirname, 'src') },
    },
    test: {
      ...(projects
        ? {
            projects: projects.map((project) => ({
              extends: true,
              test: {
                name: project.name,
                environment: project.environment ?? 'node',
                include: project.include,
                exclude: project.exclude ?? [],
                setupFiles: [...mandatorySetupFiles, ...(project.setupFiles ?? [])],
              },
            })),
          }
        : {
            environment,
            include: include ?? [],
            exclude,
            setupFiles: [...mandatorySetupFiles, ...setupFiles],
          }),
      clearMocks: true,
      unstubGlobals: true,
      unstubEnvs: true,
      coverage: {
        provider: 'v8',
        include: ['src/**/*.{ts,tsx}'],
        exclude: ['src/**/*.d.ts'],
        reporter: ['text', 'json-summary'],
        reportsDirectory: 'coverage',
        reportOnFailure: true,
        thresholds: coverageThresholds,
      },
    },
  });
}
