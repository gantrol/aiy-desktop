import type { CodexVisualizationArtifactDto } from '@/shared/contracts/codex-visualizations';

const mermaidExtensions = new Set(['.mmd', '.mermaid']);

export function isCodexMermaidArtifact(artifact: CodexVisualizationArtifactDto) {
  return artifact.kind === 'DIAGRAM_SOURCE' && mermaidExtensions.has(artifact.extension.toLowerCase());
}

export function canPreviewCodexVisualizationArtifact(artifact: CodexVisualizationArtifactDto) {
  return artifact.kind === 'INTERACTIVE' || isCodexMermaidArtifact(artifact);
}
