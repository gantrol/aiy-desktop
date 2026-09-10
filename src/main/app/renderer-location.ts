export const RENDERER_SCHEME = 'aiy-app';
export const PACKAGED_RENDERER_URL = `${RENDERER_SCHEME}://renderer/index.html`;

export function featureDemoFrameUrl(rendererUrl: URL) {
  const url = new URL('demo-petals.html', rendererUrl);
  url.search = '';
  url.hash = '';
  return url;
}

export function isFeatureDemoFrameUrl(target: URL, rendererUrl: URL) {
  const expected = featureDemoFrameUrl(rendererUrl);
  return (
    !target.username &&
    !target.password &&
    target.protocol === expected.protocol &&
    target.host === expected.host &&
    target.pathname === expected.pathname
  );
}
