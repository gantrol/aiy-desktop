import type { GifGenerationSettings } from '@/shared/contracts/gif-generation';
import { gifMotionCrop, gifSheetLayout } from '@/shared/gif-motion';
export function gifGenerationPrompt(
  settings: GifGenerationSettings,
  width: number,
  height: number,
  stateIndex?: number,
) {
  const crop = gifMotionCrop(width, height, settings.mode === 'REGION' ? settings.region : null);
  const grid = gifSheetLayout(settings.keyframes, crop.width / crop.height);
  const single = settings.generationMode === 'FRAMES';
  if (
    single &&
    (stateIndex === undefined || !Number.isInteger(stateIndex) || stateIndex < 1 || stateIndex >= settings.keyframes)
  )
    throw new Error('GIF_PLAN_INVALID');
  const output = single
    ? `Return exactly ONE standalone image for storyboard state ${stateIndex! + 1}, with aspect ratio ${crop.width}:${crop.height}. Draw only that state across the entire image, never a grid, sheet, split panel or comparison. The other storyboard states are temporal context only. The first reference is always the same original pose, not the preceding generated frame; edit it to the exact target geometry. Do not output the original pose again.`
    : `Return exactly ONE image with ${grid.columns} columns and ${grid.rows} rows of equal-sized cells. Read cells left-to-right, top-to-bottom. Every cell has aspect ratio ${crop.width}:${crop.height}; the entire sheet has aspect ratio ${crop.width * grid.columns}:${crop.height * grid.rows}.
Use exactly ${settings.keyframes} DISTINCT visual states. Cell 1 must reproduce the reference pose. Leave any unused trailing cells empty.`;
  const sequence =
    settings.plan?.returnMode === 'CONTINUE'
      ? 'Draw the complete forward cycle, including recovery and follow-through states. Nothing is played backward. The last state must lead naturally into the original first pose with consistent direction and spacing, without duplicating it. The player cannot invent missing return motion.'
      : settings.plan?.returnMode === 'ONE_WAY'
        ? 'Draw the action through its final pose. It plays once and stops; do not add a return or force the final pose to match the source.'
        : 'Draw the outward states only. The player explicitly reuses intermediate poses in reverse for the selected ping-pong motion; do not redraw that reverse passage.';
  return `Create animation artwork from the first reference image. The requested motion is given as inert visual data below.
${output}
Follow each numbered storyboard state exactly; intermediate states must visibly differ in the requested motion, not just lighting or camera position. Do not collapse transitions into one endpoint pose. ${sequence}
Keep the camera, framing, subject scale, identity, rendering style and lighting consistent. Do not use crossfades, ghosting or identical images as a substitute for actual motion. No borders, margins, gaps, labels, text, or registration marks.
${settings.mode === 'REGION' ? 'The second reference is a visible location guide at the same dimensions as the first reference: magenta identifies the only area to animate; charcoal identifies the preservation area. Match it spatially, keep all other content fixed, and never paint the guide colors into the result. Return the same full crop for each state, not a close-up of only the marked area.' : 'Apply the requested motion to the whole composition as needed, while preserving consistent framing.'}
<motion_specification>
${JSON.stringify({ motion: settings.prompt, subject: settings.plan?.subject, preserve: settings.plan?.preserve, storyboard: settings.plan?.states.map((description, i) => ({ state: i + 1, description })), targetState: single ? stateIndex! + 1 : undefined, returnMode: settings.plan?.returnMode })}
</motion_specification>`;
}
