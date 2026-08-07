import { describe, expect, it } from 'vitest';
import {
  createInitialIntakeState,
  initialIntakeState,
  intakeReducer,
  type LocalIntakeItem,
} from '../src/renderer/features/intake/intake-state';

describe('intake state', () => {
  it('keeps item order and returns to idle after the final removal', () => {
    const items: LocalIntakeItem[] = [
      { id: 'text', kind: 'TEXT', text: 'first' },
      {
        id: 'image',
        kind: 'IMAGE',
        name: 'image.png',
        mimeType: 'image/png',
        file: {} as File,
        previewUrl: 'blob:image',
        sourceUrl: '',
      },
    ];
    let state = intakeReducer(initialIntakeState, { type: 'ADD', source: 'DROP', items, skipped: [] });
    expect(state).toMatchObject({ status: 'REVIEWING', source: 'DROP' });
    state = intakeReducer(state, { type: 'MOVE', id: 'image', offset: -1 });
    expect(state.items.map((item) => item.id)).toEqual(['image', 'text']);
    state = intakeReducer(state, { type: 'EDIT_TEXT', id: 'text', text: 'edited' });
    expect(state.items[1]).toMatchObject({ text: 'edited' });
    state = intakeReducer(state, { type: 'REMOVE', id: 'image' });
    state = intakeReducer(state, { type: 'REMOVE', id: 'text' });
    expect(state).toMatchObject({ status: 'IDLE', items: [] });
  });

  it('preserves the draft when commit fails', () => {
    const reviewing = intakeReducer(initialIntakeState, {
      type: 'ADD',
      source: 'PASTE',
      items: [{ id: 'text', kind: 'TEXT', text: 'keep me' }],
      skipped: [],
    });
    const committing = intakeReducer(reviewing, { type: 'COMMITTING', intent: 'IMPORT' });
    expect(committing).toMatchObject({ status: 'COMMITTING_IMPORT', pendingIntent: 'IMPORT' });
    const failed = intakeReducer(committing, { type: 'FAILED', error: 'Disk is full' });
    expect(failed).toMatchObject({
      status: 'FAILED',
      error: 'Disk is full',
      pendingIntent: null,
      items: [{ id: 'text' }],
    });
  });

  it('uses the gallery policy without silently committing', () => {
    const idle = createInitialIntakeState('GALLERY');
    expect(idle).toMatchObject({ status: 'IDLE', defaultIntent: 'IMPORT', selectedIntent: 'IMPORT' });
    const reading = intakeReducer(idle, { type: 'READING', source: 'PASTE' });
    expect(reading).toMatchObject({ status: 'READING', items: [], pendingIntent: null });
    const reviewing = intakeReducer(reading, {
      type: 'ADD',
      source: 'PASTE',
      items: [{ id: 'text', kind: 'TEXT', text: 'review first' }],
      skipped: [],
    });
    expect(reviewing).toMatchObject({ status: 'REVIEWING', selectedIntent: 'IMPORT', items: [{ id: 'text' }] });
  });
});
