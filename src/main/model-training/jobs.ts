import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { snapshotIdentity, validateSnapshot } from '@/main/model-training/dataset';
import { digest, hashFile, readJson, writeNewJson } from '@/main/model-training/io';

export async function trainingCommand(
  command: string,
  options: Record<string, unknown>,
  python: (exe: string, args: string[]) => Promise<void>,
) {
  const job = String(options.job);
  if (command === 'status') {
    console.log(JSON.stringify(await readJson(path.join(job, 'status.json'), 1024 * 1024), null, 2));
    return;
  }
  if (command === 'pause' || command === 'cancel') {
    await readJson(path.join(job, 'spec.json'));
    await writeNewJson(path.join(job, `${command}.request`), { requestedAt: new Date().toISOString() }).catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code !== 'EEXIST') throw error;
      },
    );
    console.log(JSON.stringify({ requested: command }));
    return;
  }
  if (!options.input) throw new Error('--input is required');
  const snapshot = validateSnapshot(await readJson(path.resolve(String(options.input))));
  const train = snapshot.dataset.cases.filter((item) => item.split === 'train');
  const validation = snapshot.dataset.cases.filter((item) => item.split === 'validation');
  for (const group of [train, validation]) {
    if (
      !group.some(
        (item) =>
          item.judgments.some((j) => j.relevance === 'positive') &&
          item.judgments.some((j) => j.relevance === 'negative'),
      )
    )
      throw new Error('TRAIN_AND_VALIDATION_REQUIRE_POSITIVES_AND_NEGATIVES');
  }
  const provisional = [...train, ...validation].some((item) => item.judgments.some((j) => j.origin !== 'human'));
  if (provisional && !options['allow-provisional']) throw new Error('PROVISIONAL_LABELS_REQUIRE_EXPLICIT_OPTION');
  const number = (key: string, min: number, max: number) => {
    const value = Number(options[key]);
    if (!Number.isInteger(value) || value < min || value > max) throw new Error(`INVALID_${key.toUpperCase()}_BUDGET`);
    return value;
  };
  const spec = {
    schema: 1,
    datasetId: snapshot.datasetId,
    modelDigest: snapshot.modelDigest,
    snapshotId: snapshotIdentity(snapshot),
    executorDigest: await hashFile(
      path.join(String(options.sourceRoot), 'scripts/model-training/worker.py'),
      1024 * 1024,
    ),
    steps: number('steps', 1, 10_000),
    seconds: number('seconds', 1, 3600),
    rank: number('rank', 1, 32),
    seed: number('seed', 0, 2 ** 31 - 1),
    device: options.device,
    provisional,
    recipe: 'query-residual-v1',
    checkpointEvery: 10,
    // Held-out query text, judgments and vectors never enter the training process.
    entries: snapshot.dataset.entries.map((entry) => ({ id: entry.id, sourceGroup: entry.sourceGroup })),
    images: snapshot.images,
    cases: [...train, ...validation],
    queries: Object.fromEntries([...train, ...validation].map((item) => [item.id, snapshot.queries[item.id]])),
  };
  if (spec.device !== 'CPU' && spec.device !== 'GPU') throw new Error('DEVICE_MUST_BE_CPU_OR_GPU');
  await mkdir(job, { recursive: true });
  const specPath = path.join(job, 'spec.json');
  try {
    await writeNewJson(specPath, spec);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    if (digest(await readJson(specPath)) !== digest(spec)) throw new Error('JOB_SPEC_CONFLICT');
    if (!options.resume) throw new Error('JOB_EXISTS_USE_RESUME');
  }
  const workerArgs = ['train', '--job', job];
  if (options.resume) workerArgs.push('--resume');
  await python(String(options.python), workerArgs);
}
