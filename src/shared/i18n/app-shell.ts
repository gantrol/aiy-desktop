/** Shared English base for the renderer catalog and application shell. */
export const appShellMessages = {
  open: 'Open AIY',
  'petals-open': 'Open AIY Petals',
  'petals-show-all': 'Restore Desktop',
  'petals-hide-all': 'Temporarily Hide Desktop',
  'petals-settings': 'Petals Settings',
  starting: 'Starting…',
  tasksRunning: 'Background tasks: {count} running',
  tasksIdle: 'Background tasks: idle',
  tasksCompleted: 'Background tasks: completed · quitting soon',
  tasksTooltip: 'AIY · {count} tasks',
  completionNotification: 'Background tasks completed. The app will quit in 30 seconds.',
  quit: 'Quit',
  quitPending: 'Quit…',
  forceQuit: 'Force Quit',
  forceQuitPending: 'Force Quit…',
  forceQuitQuestion: 'Force quit and interrupt background tasks?',
  forceQuitDetail:
    'Force quitting interrupts unfinished tasks and may discard unsaved results. Saved work is not affected.',
  goBack: 'Go Back',
  pendingClose: '{count} model tasks still running',
  pendingCloseDetail:
    'Keep the tasks running in the background, cancel them before quitting, or force an interruption after confirmation.',
  continueBackground: 'Continue in Background',
  cancelAndQuit: 'Cancel Tasks and Quit',
  cancelFailed: 'Unable to cancel background tasks: {reason}',
  shutdownFailed: 'Unable to close the background model service cleanly: {reason}',
  updatePending: '{count} running model tasks must stop before updating',
  updateDetail:
    'After cancelling the tasks, the app will close the current local space safely and install the downloaded update.',
  cancelAndUpdate: 'Cancel Tasks and Update',
  notNow: 'Not Now',
};

export type AppShellMessages = { [Key in keyof typeof appShellMessages]: string };
