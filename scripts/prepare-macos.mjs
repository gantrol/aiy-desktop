if (process.platform === 'darwin') {
  await import('./build-macos-petal-input.mjs');
  await import('./prepare-macos-icons.mjs');
}
