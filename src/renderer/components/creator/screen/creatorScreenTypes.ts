import type { ReactNode } from 'react';
import type { ArticleDto, BootstrapDto, ImportedCreationOutputDto, Locale, VideoDocumentDto } from '@/shared/contracts';
import type { CreatorLocation, CreatorOpenTabTarget, NavigationMode } from '@/renderer/components/app/app-navigation';

export interface CreatorScreenProps {
  data: BootstrapDto;
  dataRevision: number;
  locale: Locale;
  defaultPromptLocale: Locale | null;
  active: boolean;
  creationLibraryActive: boolean;
  location: CreatorLocation;
  comparisonFullWindow: boolean;
  promptFullWindow: boolean;
  documentWorkspace: ReactNode | null;
  documentWorkspaceActive: boolean;
  selectedDocumentId: string | null;
  selectedDocumentAlbumId: string | null;
  documentNavigationRevision: number;
  onSelectDocument(documentId: string, albumId: string | null): void;
  onDocumentsChange(document: VideoDocumentDto, collectionChanged: boolean): void;
  onNavigate(location: CreatorLocation, mode?: NavigationMode): void;
  onOpenInNewTab(target: CreatorOpenTabTarget): void;
  onComparisonFullWindowChange(open: boolean): void;
  onPromptFullWindowChange(open: boolean): void;
  onOpenMaterial(materialId: string): void;
  onConfigureExtension(extensionId: string): void;
  onActiveAlbumChange(albumId: string | null): void;
  refresh(): Promise<void>;
  refreshAlbums(): Promise<void>;
  onTermDetailsRequest?(): Promise<void>;
  onImportedOutputSaved(output: ImportedCreationOutputDto): void;
  onArticleSaved(article: ArticleDto): void;
  notify(message: string): void;
}
