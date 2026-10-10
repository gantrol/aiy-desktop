import path from 'node:path';
import { parseArgs } from 'node:util';
import { spawn } from 'node:child_process';
import { catalogImages } from '@/main/model-training/catalog';
import { captureDataset } from '@/main/model-training/capture';
import { validateDataset, validateSnapshot } from '@/main/model-training/dataset';
import { evaluateSnapshot } from '@/main/model-training/evaluate';
import { digest, readJson, writeNewJson } from '@/main/model-training/io';
import { queryAdapterSchema, trainingCaseSchema } from '@/shared/model-training';
import { classifyRelations } from '@/main/model-training/relations';

declare const __FURNACE_SOURCE_ROOT__: string;

export async function main(args: string[]) {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      input: { type: 'string' },
      out: { type: 'string' },
      library: { type: 'string' },
      model: { type: 'string' },
      device: { type: 'string', default: 'CPU' },
      limit: { type: 'string' },
      exclude: { type: 'string' },
      'facet-key': { type: 'string' },
      'exclude-facet-value': { type: 'string', multiple: true },
      candidate: { type: 'string' },
      split: { type: 'string', default: 'acceptance' },
      python: { type: 'string', default: 'python' },
      job: { type: 'string' },
      steps: { type: 'string', default: '100' },
      seconds: { type: 'string', default: '600' },
      rank: { type: 'string', default: '8' },
      seed: { type: 'string', default: '42' },
      resume: { type: 'boolean', default: false },
      'allow-provisional': { type: 'boolean', default: false },
      help: { type: 'boolean' },
    },
  });
  const required = (key: 'input' | 'out' | 'library' | 'model' | 'job') => {
    const value = values[key];
    if (!value) throw new Error(`--${key} is required`);
    if (value.toLowerCase().includes('trash')) throw new Error('EXCLUDED_SOURCE_PATH');
    return path.resolve(value);
  };
  const command = positionals[0];
  if (!command || values.help) {
    console.log(
      'AIY furnace: catalog --library DIR --out FILE [--limit 32]\n' +
        'dictionary --library DIR --out DATASET [--limit 160 --exclude DATASET --facet-key KEY --exclude-facet-value VALUE]\n' +
        'classify --input DATASET --out REPORT\n' +
        'suggest --input SNAPSHOT --out REPORT [--limit 5]\n' +
        'freeze --input DATASET --out FILE\n' +
        'capture --input DATASET --model DIR --out SNAPSHOT [--device CPU|GPU]\n' +
        'evaluate|compare --input SNAPSHOT --out REPORT [--candidate FILE] [--split train|validation|acceptance]\n' +
        'doctor [--python EXE]\n' +
        'train --input SNAPSHOT --job DIR [--steps 100 --seconds 600 --rank 8 --seed 42 --device GPU --resume --allow-provisional]\n' +
        'pause|cancel|status --job DIR',
    );
    return;
  }
  if (command === 'catalog') {
    const limit = Number(values.limit ?? '32');
    if (!Number.isInteger(limit) || limit < 2 || limit > 256) throw new Error('LIMIT_MUST_BE_2_TO_256');
    const catalog = await catalogImages(required('library'), limit);
    await writeNewJson(required('out'), catalog);
    console.log(JSON.stringify(catalog.selection));
  } else if (command === 'dictionary') {
    const limit = Number(values.limit ?? '160');
    if (!Number.isInteger(limit) || limit < 2 || limit > 256) throw new Error('LIMIT_MUST_BE_2_TO_256');
    const excluded = values.exclude ? validateDataset(await readJson(path.resolve(values.exclude))).entries : [];
    const { seedDictionary } = await import('@/main/model-training/dictionary');
    const result = await seedDictionary(required('library'), limit, new Set(excluded.map((entry) => entry.revision)), {
      facetKey: values['facet-key'],
      excludedFacetValues: values['exclude-facet-value'] ?? [],
    });
    const out = required('out');
    await writeNewJson(`${out}.sources.json`, result.manifest);
    await writeNewJson(`${out}.relations.json`, classifyRelations(result.dataset));
    await writeNewJson(out, result.dataset);
    console.log(
      JSON.stringify({
        terms: result.manifest.selectedTerms,
        queries: result.manifest.queryCount,
        images: result.manifest.imageCount,
        reviewItems: result.manifest.reviews.length,
        domains: result.manifest.domainCounts,
      }),
    );
  } else if (command === 'classify') {
    const report = classifyRelations(validateDataset(await readJson(required('input'))));
    await writeNewJson(required('out'), report);
    console.log(JSON.stringify(report.summary));
  } else if (command === 'suggest') {
    const { suggestRelations } = await import('@/main/model-training/suggest');
    const report = suggestRelations(validateSnapshot(await readJson(required('input'))), Number(values.limit ?? '5'));
    await writeNewJson(required('out'), report);
    console.log(JSON.stringify(report.summary));
  } else if (command === 'freeze') {
    const dataset = validateDataset(await readJson(required('input')));
    await writeNewJson(required('out'), dataset);
    console.log(
      JSON.stringify({ datasetId: digest(dataset), entries: dataset.entries.length, queries: dataset.cases.length }),
    );
  } else if (command === 'capture') {
    if (values.device !== 'CPU' && values.device !== 'GPU') throw new Error('DEVICE_MUST_BE_CPU_OR_GPU');
    const cancellation = new AbortController();
    const cancel = () => cancellation.abort(new Error('CANCELLED'));
    process.once('SIGINT', cancel);
    process.once('SIGTERM', cancel);
    try {
      const snapshot = await captureDataset(
        await readJson(required('input')),
        required('model'),
        values.device,
        cancellation.signal,
      );
      await writeNewJson(required('out'), snapshot);
      console.log(JSON.stringify({ datasetId: snapshot.datasetId, prepareMs: snapshot.prepareMs }));
    } finally {
      process.removeListener('SIGINT', cancel);
      process.removeListener('SIGTERM', cancel);
    }
  } else if (command === 'evaluate' || command === 'compare') {
    const snapshot = validateSnapshot(await readJson(required('input')));
    const adapter = values.candidate
      ? queryAdapterSchema.parse(await readJson(path.resolve(values.candidate), 2 * 1024 * 1024))
      : null;
    const report = evaluateSnapshot(snapshot, adapter, trainingCaseSchema.shape.split.parse(values.split));
    if (command === 'compare') {
      if (!adapter) throw new Error('--candidate is required');
      const baseline = evaluateSnapshot(snapshot, null, report.split);
      const delta = Object.fromEntries(
        Object.entries(report.mean).map(([key, value]) => {
          const original = baseline.mean[key as keyof typeof baseline.mean];
          // A single warm ranking pass is not a latency benchmark.
          return [key, key === 'rankMs' || value === null || original === null ? null : value - original];
        }),
      );
      await writeNewJson(required('out'), { schema: 1, baseline, candidate: report, delta, deploymentApproved: false });
      console.log(
        JSON.stringify({
          split: report.split,
          cases: report.cases,
          groups: report.groups,
          provisional: report.provisional,
          delta,
        }),
      );
    } else {
      await writeNewJson(required('out'), report);
      console.log(
        JSON.stringify({
          split: report.split,
          cases: report.cases,
          groups: report.groups,
          provisional: report.provisional,
          mean: report.mean,
        }),
      );
    }
  } else if (command === 'doctor') {
    await pythonCommand(values.python!, ['doctor']);
  } else if (['train', 'pause', 'cancel', 'status'].includes(command)) {
    const { trainingCommand } = await import('@/main/model-training/jobs');
    await trainingCommand(
      command,
      { ...values, job: required('job'), sourceRoot: __FURNACE_SOURCE_ROOT__ },
      pythonCommand,
    );
  } else throw new Error(`Unknown command: ${command}`);
}

export async function pythonCommand(python: string, args: string[]) {
  const child = spawn(python, ['-u', path.join(__FURNACE_SOURCE_ROOT__, 'scripts/model-training/worker.py'), ...args], {
    stdio: 'inherit',
    windowsHide: true,
    env: { ...process.env, PYTHONUTF8: '1', PYTHONDONTWRITEBYTECODE: '1' },
  });
  await new Promise<void>((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code) => (code === 0 ? resolve() : reject(new Error(`TRAINING_PROCESS_EXIT:${code}`))));
  });
}
