/** A local space is the product-level data and ownership boundary. */
export interface LocalSpaceDescriptorDto {
  id: string;
  name: string;
  /** Managed cover URL. Null keeps the product's default space icon. */
  coverUrl: string | null;
  isCurrent: boolean;
  available: boolean;
  createdAt: string;
  lastOpenedAt: string;
}

export interface LocalSpaceRegistryDto {
  currentSpaceId: string;
  spaces: LocalSpaceDescriptorDto[];
}

export type LocalSpaceSwitchResult = { status: 'cancelled' } | { status: 'switched'; space: LocalSpaceDescriptorDto };

export type LocalSpaceCoverUpdateResult =
  { status: 'cancelled' } | { status: 'updated'; space: LocalSpaceDescriptorDto };

export type LocalSpaceTransitionStage =
  | 'PREPARING'
  | 'OPENING_DATABASE'
  | 'CONNECTING_SERVICES'
  | 'LOADING_EXTENSIONS'
  | 'APPLYING_SETTINGS'
  | 'ACTIVATING'
  | 'LOADING_INTERFACE'
  | 'READY'
  | 'FAILED';

export interface LocalSpaceTransitionEvent {
  phase: 'STARTING' | 'PROGRESS' | 'COMPLETED' | 'FAILED';
  stage: LocalSpaceTransitionStage;
  /** Milestone progress reported by completed switch work, from 0 to 100. */
  progress: number;
  space: LocalSpaceDescriptorDto;
  /** Small, cached images used only by the transition scene. */
  previewUrls: string[];
}
