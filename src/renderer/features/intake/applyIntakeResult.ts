import type { BootstrapDto, ImportedCreationOutputDto, IntakeCommitResult } from '@/shared/contracts';

export function mergeImportedOutput(
  current: BootstrapDto | null,
  output: ImportedCreationOutputDto,
): BootstrapDto | null {
  if (!current) return current;
  return {
    ...current,
    series: current.series.map((series) =>
      series.id === output.seriesId
        ? {
            ...series,
            importedOutputs: (series.importedOutputs ?? []).map((candidate) =>
              candidate.id === output.id ? output : candidate,
            ),
          }
        : series,
    ),
  };
}

export function mergeIntakeResult(current: BootstrapDto | null, result: IntakeCommitResult): BootstrapDto | null {
  if (!current) return current;
  const outputsBySeries = new Map<string, ImportedCreationOutputDto[]>();
  for (const output of result.linkedOutputs ?? []) {
    const outputs = outputsBySeries.get(output.seriesId) ?? [];
    outputs.push(output);
    outputsBySeries.set(output.seriesId, outputs);
  }
  return {
    ...current,
    libraryEmpty: false,
    creationDraft: result.draft ?? current.creationDraft,
    series: current.series.map((series) => {
      const linked = outputsBySeries.get(series.id);
      if (!linked?.length) return series;
      const importedOutputs = [...(series.importedOutputs ?? [])];
      for (const output of linked) {
        const index = importedOutputs.findIndex((candidate) => candidate.id === output.id);
        if (index >= 0) importedOutputs[index] = output;
        else importedOutputs.push(output);
      }
      return { ...series, importedOutputs };
    }),
  };
}
