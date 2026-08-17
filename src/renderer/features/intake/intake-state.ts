import type {
  IntakeCommitIntent,
  IntakeCommitSource,
  IntakeImageMimeType,
  IntakeVideoMimeType,
} from '@/shared/contracts';
import { intakeContextPolicy, type IntakeContext } from '@/renderer/features/intake/intake-context-policy';

export const maxIntakeItems = 16;

export type LocalIntakeItem =
  | { id: string; kind: 'TEXT'; text: string }
  | {
      id: string;
      kind: 'IMAGE';
      name: string;
      mimeType: IntakeImageMimeType;
      file: File;
      previewUrl: string;
      width?: number;
      height?: number;
      sourceUrl: string;
    }
  | {
      id: string;
      kind: 'VIDEO';
      name: string;
      mimeType: IntakeVideoMimeType;
      file: File;
      previewUrl: string;
      width: number;
      height: number;
      durationMs: number;
      sourceUrl: string;
    };

export type IntakeStatus = 'IDLE' | 'READING' | 'REVIEWING' | 'COMMITTING_IMPORT' | 'COMMITTING_CREATE' | 'FAILED';

export type IntakeState = {
  context: IntakeContext;
  status: IntakeStatus;
  source: IntakeCommitSource;
  items: LocalIntakeItem[];
  dragActive: boolean;
  error: string;
  /** Files the last add dropped because of type, size, or batch limits. */
  skipped: string[];
  favorite: boolean;
  defaultIntent: IntakeCommitIntent;
  selectedIntent: IntakeCommitIntent;
  pendingIntent: IntakeCommitIntent | null;
};

export type IntakeAction =
  | { type: 'READING'; source: IntakeCommitSource }
  | { type: 'ADD'; source: IntakeCommitSource; items: LocalIntakeItem[]; skipped: string[] }
  | { type: 'SKIPPED'; names: string[] }
  | { type: 'REMOVE'; id: string }
  | { type: 'EDIT_TEXT'; id: string; text: string }
  | { type: 'MOVE'; id: string; offset: -1 | 1 }
  | { type: 'DRAG_ACTIVE'; active: boolean }
  | { type: 'SELECT_INTENT'; intent: IntakeCommitIntent }
  | { type: 'SET_FAVORITE'; favorite: boolean }
  | { type: 'COMMITTING'; intent: IntakeCommitIntent }
  | { type: 'FAILED'; error: string }
  | { type: 'RESET' };

export function createInitialIntakeState(context: IntakeContext = 'LIBRARY_START'): IntakeState {
  const policy = intakeContextPolicy(context);
  return {
    context,
    status: 'IDLE',
    source: 'PASTE',
    items: [],
    dragActive: false,
    error: '',
    skipped: [],
    favorite: policy.defaultFavorite,
    defaultIntent: policy.defaultIntent,
    selectedIntent: policy.defaultIntent,
    pendingIntent: null,
  };
}

export const initialIntakeState = createInitialIntakeState();

export function intakeReducer(state: IntakeState, action: IntakeAction): IntakeState {
  if (action.type === 'READING') {
    return { ...state, source: action.source, status: 'READING', dragActive: false, error: '', pendingIntent: null };
  }
  if (action.type === 'ADD') {
    const seen = new Set(state.items.map((item) => item.id));
    const items = [...state.items, ...action.items.filter((item) => !seen.has(item.id))].slice(0, maxIntakeItems);
    return {
      ...state,
      source: action.source,
      items,
      status: items.length ? 'REVIEWING' : 'IDLE',
      error: '',
      skipped: action.skipped,
      pendingIntent: null,
    };
  }
  if (action.type === 'SKIPPED') {
    return { ...state, skipped: action.names, dragActive: false };
  }
  if (action.type === 'REMOVE') {
    const items = state.items.filter((item) => item.id !== action.id);
    return { ...state, items, status: items.length ? 'REVIEWING' : 'IDLE', error: '', pendingIntent: null };
  }
  if (action.type === 'EDIT_TEXT') {
    return {
      ...state,
      items: state.items.map((item) =>
        item.id === action.id && item.kind === 'TEXT' ? { ...item, text: action.text } : item,
      ),
    };
  }
  if (action.type === 'MOVE') {
    const index = state.items.findIndex((item) => item.id === action.id);
    const destination = index + action.offset;
    if (index < 0 || destination < 0 || destination >= state.items.length) return state;
    const items = [...state.items];
    [items[index], items[destination]] = [items[destination], items[index]];
    return { ...state, items };
  }
  if (action.type === 'DRAG_ACTIVE') return { ...state, dragActive: action.active };
  if (action.type === 'SELECT_INTENT') return { ...state, selectedIntent: action.intent };
  if (action.type === 'SET_FAVORITE') return { ...state, favorite: action.favorite };
  if (action.type === 'COMMITTING')
    return {
      ...state,
      status: action.intent === 'IMPORT' ? 'COMMITTING_IMPORT' : 'COMMITTING_CREATE',
      error: '',
      selectedIntent: action.intent,
      pendingIntent: action.intent,
    };
  if (action.type === 'FAILED') return { ...state, status: 'FAILED', error: action.error, pendingIntent: null };
  return createInitialIntakeState(state.context);
}
