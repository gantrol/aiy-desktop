import {
  FEATURE_DEMO_PREVIEW_HEIGHT,
  FEATURE_DEMO_PREVIEW_WIDTH,
  featureDemoSceneAt,
  type FeatureDemoSceneId,
} from '@/renderer/features/extensions/feature-demo/featureDemoTimeline';

export interface FeatureDemoCopy {
  brand: string;
  introTitle: string;
  introSubtitle: string;
  thumbnailExpandTitle: string;
  thumbnailExpandSubtitle: string;
  thumbnailCollapseTitle: string;
  thumbnailCollapseSubtitle: string;
  codexImagesTitle: string;
  codexImagesSubtitle: string;
  promptCompareTitle: string;
  promptCompareSubtitle: string;
  videoDocumentTitle: string;
  videoDocumentSubtitle: string;
  outroTitle: string;
  outroSubtitle: string;
  tasks: string;
  library: string;
  prompt: string;
  model: string;
  version: string;
  video: string;
  article: string;
  transcript: string;
  importAction: string;
}

const palette = {
  background: '#f5f3ef',
  surface: '#ffffff',
  sunken: '#ebe8e1',
  ink: '#23211f',
  muted: '#746f68',
  border: '#d8d3cb',
  accent: '#cf5f3b',
  accentSoft: '#f3d8ce',
  blue: '#557a95',
  blueSoft: '#dce8ef',
  green: '#50785d',
  greenSoft: '#dce9df',
} as const;

const fontFamily = 'Inter, "Microsoft YaHei", "PingFang SC", system-ui, sans-serif';

function clamp(value: number, minimum = 0, maximum = 1) {
  return Math.min(maximum, Math.max(minimum, value));
}

function ease(value: number) {
  const bounded = clamp(value);
  return bounded < 0.5 ? 4 * bounded * bounded * bounded : 1 - Math.pow(-2 * bounded + 2, 3) / 2;
}

function lerp(start: number, end: number, progress: number) {
  return start + (end - start) * progress;
}

function roundedRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  const boundedRadius = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + boundedRadius, y);
  context.arcTo(x + width, y, x + width, y + height, boundedRadius);
  context.arcTo(x + width, y + height, x, y + height, boundedRadius);
  context.arcTo(x, y + height, x, y, boundedRadius);
  context.arcTo(x, y, x + width, y, boundedRadius);
  context.closePath();
}

function fillRoundRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
  fill: string | CanvasGradient | CanvasPattern,
  stroke?: string,
) {
  roundedRect(context, x, y, width, height, radius);
  context.fillStyle = fill;
  context.fill();
  if (stroke) {
    context.strokeStyle = stroke;
    context.lineWidth = 1;
    context.stroke();
  }
}

function text(
  context: CanvasRenderingContext2D,
  value: string,
  x: number,
  y: number,
  size: number,
  color: string = palette.ink,
  weight: 400 | 500 | 600 | 700 = 400,
  align: CanvasTextAlign = 'left',
) {
  context.font = `${weight} ${size}px ${fontFamily}`;
  context.fillStyle = color;
  context.textAlign = align;
  context.textBaseline = 'alphabetic';
  context.fillText(value, x, y);
}

function line(context: CanvasRenderingContext2D, x: number, y: number, width: number, color: string = palette.border) {
  context.fillStyle = color;
  context.fillRect(x, y, width, 2);
}

function sceneHeading(context: CanvasRenderingContext2D, title: string, subtitle: string) {
  text(context, title, 72, 86, 34, palette.ink, 700);
  text(context, subtitle, 72, 124, 18, palette.muted, 400);
}

function appFrame(context: CanvasRenderingContext2D, title: string) {
  fillRoundRect(context, 58, 156, 1164, 512, 18, palette.surface, palette.border);
  context.fillStyle = palette.sunken;
  context.fillRect(59, 157, 1162, 54);
  context.fillStyle = '#de7760';
  context.beginPath();
  context.arc(84, 184, 6, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = '#d8ad55';
  context.beginPath();
  context.arc(104, 184, 6, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = '#6ba276';
  context.beginPath();
  context.arc(124, 184, 6, 0, Math.PI * 2);
  context.fill();
  text(context, title, 640, 190, 16, palette.muted, 600, 'center');
}

function thumbnailGradient(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  hue: number,
) {
  const gradient = context.createLinearGradient(x, y, x + width, y + height);
  gradient.addColorStop(0, `hsl(${hue} 58% 78%)`);
  gradient.addColorStop(1, `hsl(${(hue + 48) % 360} 44% 42%)`);
  fillRoundRect(context, x, y, width, height, 10, gradient);
  context.fillStyle = 'rgba(255,255,255,0.36)';
  context.beginPath();
  context.arc(x + width * 0.76, y + height * 0.26, Math.min(width, height) * 0.12, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = 'rgba(25,22,20,0.18)';
  context.beginPath();
  context.moveTo(x, y + height);
  context.lineTo(x + width * 0.32, y + height * 0.45);
  context.lineTo(x + width * 0.57, y + height * 0.72);
  context.lineTo(x + width, y + height * 0.34);
  context.lineTo(x + width, y + height);
  context.closePath();
  context.fill();
}

function cursor(context: CanvasRenderingContext2D, x: number, y: number, pressed = false) {
  context.save();
  context.translate(x, y);
  context.scale(pressed ? 0.92 : 1, pressed ? 0.92 : 1);
  context.beginPath();
  context.moveTo(0, 0);
  context.lineTo(0, 30);
  context.lineTo(8, 23);
  context.lineTo(15, 39);
  context.lineTo(23, 35);
  context.lineTo(16, 20);
  context.lineTo(28, 19);
  context.closePath();
  context.fillStyle = '#ffffff';
  context.strokeStyle = '#181614';
  context.lineWidth = 2.5;
  context.fill();
  context.stroke();
  context.restore();
}

function drawThumbnailWorkspace(
  context: CanvasRenderingContext2D,
  copy: FeatureDemoCopy,
  drawerProgress: number,
  cursorPosition: readonly [number, number],
) {
  appFrame(context, copy.library);
  context.fillStyle = '#f2f0eb';
  context.fillRect(59, 211, 180, 456);
  text(context, copy.library, 82, 250, 17, palette.ink, 600);
  for (let index = 0; index < 5; index += 1) {
    fillRoundRect(context, 80, 274 + index * 52, 136, 34, 8, index === 1 ? palette.accentSoft : 'transparent');
    context.fillStyle = index === 1 ? palette.accent : palette.muted;
    context.beginPath();
    context.arc(96, 291 + index * 52, 4, 0, Math.PI * 2);
    context.fill();
    line(context, 108, 290 + index * 52, 82, index === 1 ? '#bb765e' : '#c7c1b8');
  }

  const cards = [
    { x: 274, hue: 15 },
    { x: 498, hue: 194 },
    { x: 722, hue: 286 },
    { x: 946, hue: 96 },
  ];
  for (const [index, card] of cards.entries()) {
    thumbnailGradient(context, card.x, 250, 192, 132, card.hue);
    if (index === 1) {
      context.strokeStyle = palette.accent;
      context.lineWidth = 4;
      roundedRect(context, card.x - 2, 248, 196, 136, 12);
      context.stroke();
    }
  }

  const drawerHeight = 178 * clamp(drawerProgress);
  context.save();
  roundedRect(context, 274, 398, 864, drawerHeight, 12);
  context.clip();
  fillRoundRect(context, 274, 398, 864, 178, 12, '#f8f7f4', palette.border);
  text(context, copy.prompt, 304, 438, 15, palette.muted, 600);
  line(context, 304, 460, 478, '#bbb5ad');
  line(context, 304, 482, 612, '#d0cbc3');
  text(context, copy.model, 840, 438, 15, palette.muted, 600);
  fillRoundRect(context, 840, 454, 120, 34, 8, palette.blueSoft);
  text(context, 'Codex', 900, 477, 14, palette.blue, 600, 'center');
  text(context, copy.version, 986, 438, 15, palette.muted, 600);
  fillRoundRect(context, 986, 454, 110, 34, 8, palette.greenSoft);
  text(context, 'V03', 1041, 477, 14, palette.green, 600, 'center');
  context.restore();
  cursor(context, cursorPosition[0], cursorPosition[1]);
}

function drawIntro(context: CanvasRenderingContext2D, progress: number, copy: FeatureDemoCopy) {
  const appear = ease(clamp(progress / 0.45));
  const offset = lerp(26, 0, appear);
  text(context, copy.brand, 640, 284 + offset, 82, palette.ink, 700, 'center');
  text(context, copy.introTitle, 640, 360 + offset, 36, palette.ink, 600, 'center');
  text(context, copy.introSubtitle, 640, 410 + offset, 22, palette.muted, 400, 'center');
  fillRoundRect(context, 452, 468, 376, 72, 16, palette.surface, palette.border);
  text(context, 'AI', 552, 515, 24, palette.accent, 700, 'center');
  text(context, '+', 640, 515, 24, palette.muted, 500, 'center');
  text(context, 'DIY', 728, 515, 24, palette.blue, 700, 'center');
}

function drawThumbnailExpand(context: CanvasRenderingContext2D, progress: number, copy: FeatureDemoCopy) {
  sceneHeading(context, copy.thumbnailExpandTitle, copy.thumbnailExpandSubtitle);
  const cursorMove = ease(clamp((progress - 0.05) / 0.28));
  const drawer = ease(clamp((progress - 0.28) / 0.32));
  drawThumbnailWorkspace(context, copy, drawer, [lerp(1100, 585, cursorMove), lerp(570, 316, cursorMove)] as const);
}

function drawThumbnailCollapse(context: CanvasRenderingContext2D, progress: number, copy: FeatureDemoCopy) {
  sceneHeading(context, copy.thumbnailCollapseTitle, copy.thumbnailCollapseSubtitle);
  const cursorMove = ease(clamp((progress - 0.05) / 0.28));
  const drawer = 1 - ease(clamp((progress - 0.3) / 0.34));
  drawThumbnailWorkspace(context, copy, drawer, [lerp(1080, 585, cursorMove), lerp(564, 316, cursorMove)] as const);
}

function drawCodexImages(context: CanvasRenderingContext2D, progress: number, copy: FeatureDemoCopy) {
  sceneHeading(context, copy.codexImagesTitle, copy.codexImagesSubtitle);
  appFrame(context, `${copy.tasks} → ${copy.library}`);
  fillRoundRect(context, 82, 238, 424, 394, 12, '#f4f2ee', palette.border);
  text(context, copy.tasks, 108, 276, 18, palette.ink, 700);
  for (let index = 0; index < 3; index += 1) {
    const y = 302 + index * 98;
    fillRoundRect(context, 106, y, 374, 76, 10, index === 1 ? palette.accentSoft : palette.surface, palette.border);
    text(context, `Task ${String(index + 1).padStart(2, '0')}`, 130, y + 30, 15, palette.ink, 600);
    text(context, `${3 + index} images`, 130, y + 54, 13, palette.muted, 400);
    thumbnailGradient(context, 400, y + 12, 54, 52, 25 + index * 84);
  }

  fillRoundRect(context, 548, 238, 642, 394, 12, palette.surface, palette.border);
  text(context, copy.library, 578, 276, 18, palette.ink, 700);
  const transfer = ease(clamp((progress - 0.2) / 0.42));
  for (let index = 0; index < 6; index += 1) {
    const column = index % 3;
    const row = Math.floor(index / 3);
    const targetX = 578 + column * 194;
    const targetY = 304 + row * 140;
    const sourceX = 402 + (index % 2) * 26;
    const sourceY = 324 + (index % 3) * 98;
    const localTransfer = ease(clamp(transfer * 1.35 - index * 0.08));
    const x = lerp(sourceX, targetX, localTransfer);
    const y = lerp(sourceY, targetY, localTransfer);
    thumbnailGradient(context, x, y, 164, 112, 20 + index * 56);
  }
  const buttonProgress = ease(clamp((progress - 0.05) / 0.22));
  fillRoundRect(context, 976, 255, 178, 38, 9, palette.accent);
  text(context, copy.importAction, 1065, 281, 14, '#ffffff', 600, 'center');
  cursor(context, lerp(1140, 1060, buttonProgress), lerp(350, 272, buttonProgress), progress > 0.18 && progress < 0.24);
}

function drawPromptCompare(context: CanvasRenderingContext2D, progress: number, copy: FeatureDemoCopy) {
  sceneHeading(context, copy.promptCompareTitle, copy.promptCompareSubtitle);
  appFrame(context, copy.promptCompareTitle);
  const matrixX = 282;
  const matrixY = 254;
  const cardWidth = 198;
  const cardHeight = 146;
  text(context, `${copy.prompt} V01`, 174, 348, 15, palette.muted, 600, 'center');
  text(context, `${copy.prompt} V02`, 174, 520, 15, palette.muted, 600, 'center');
  text(context, `${copy.model} A`, 381, 242, 15, palette.muted, 600, 'center');
  text(context, `${copy.model} B`, 605, 242, 15, palette.muted, 600, 'center');
  for (let row = 0; row < 2; row += 1) {
    for (let column = 0; column < 2; column += 1) {
      const index = row * 2 + column;
      const x = matrixX + column * 224;
      const y = matrixY + row * 172;
      thumbnailGradient(context, x, y, cardWidth, cardHeight, 18 + index * 76);
      if (index === 3 && progress > 0.42) {
        context.strokeStyle = palette.accent;
        context.lineWidth = 5;
        roundedRect(context, x - 3, y - 3, cardWidth + 6, cardHeight + 6, 13);
        context.stroke();
      }
    }
  }

  fillRoundRect(context, 778, 254, 380, 318, 12, '#f8f7f4', palette.border);
  text(context, copy.prompt, 808, 294, 16, palette.ink, 700);
  line(context, 808, 320, 302, '#b9b3aa');
  line(context, 808, 346, 260, '#d0cbc3');
  line(context, 808, 372, 322, '#d0cbc3');
  const diff = ease(clamp((progress - 0.3) / 0.32));
  fillRoundRect(context, 808, 404, 304 * diff, 34, 8, palette.accentSoft);
  if (diff > 0.2) text(context, '+ warm side light', 824, 427, 14, palette.accent, 600);
  fillRoundRect(context, 808, 464, 144, 34, 8, palette.blueSoft);
  text(context, 'Model B', 880, 487, 14, palette.blue, 600, 'center');
  fillRoundRect(context, 968, 464, 108, 34, 8, palette.greenSoft);
  text(context, 'V02', 1022, 487, 14, palette.green, 600, 'center');
  const cursorMove = ease(clamp((progress - 0.08) / 0.46));
  cursor(context, lerp(1120, 608, cursorMove), lerp(600, 500, cursorMove));
}

function drawVideoDocument(context: CanvasRenderingContext2D, progress: number, copy: FeatureDemoCopy) {
  sceneHeading(context, copy.videoDocumentTitle, copy.videoDocumentSubtitle);
  appFrame(context, `${copy.video} → ${copy.article}`);
  fillRoundRect(context, 84, 238, 496, 344, 12, '#242424');
  const playhead = clamp((progress - 0.08) / 0.72);
  thumbnailGradient(context, 108, 262, 448, 236, 202);
  context.fillStyle = 'rgba(20,18,17,0.72)';
  context.fillRect(108, 514, 448, 44);
  for (let index = 0; index < 8; index += 1) {
    thumbnailGradient(context, 116 + index * 53, 522, 45, 28, 16 + index * 42);
  }
  context.fillStyle = palette.accent;
  context.fillRect(116 + playhead * 371, 514, 3, 44);
  text(context, copy.video, 108, 612, 15, palette.muted, 600);

  const articleProgress = ease(clamp((progress - 0.22) / 0.52));
  fillRoundRect(context, 626, 238, 550, 394, 12, palette.surface, palette.border);
  text(context, copy.article, 656, 278, 18, palette.ink, 700);
  text(context, copy.transcript, 656, 316, 14, palette.muted, 600);
  for (let index = 0; index < 5; index += 1) {
    line(context, 656, 338 + index * 24, (424 - index * 32) * articleProgress, '#c6c0b8');
  }
  const imageWidth = 190 * articleProgress;
  if (imageWidth > 1) thumbnailGradient(context, 656, 478, imageWidth, 112, 34);
  for (let index = 0; index < 3; index += 1) {
    line(context, 868, 494 + index * 28, (250 - index * 24) * articleProgress, '#c6c0b8');
  }
  const cursorMove = ease(clamp((progress - 0.06) / 0.34));
  cursor(context, lerp(462, 1030, cursorMove), lerp(548, 584, cursorMove));
}

function drawOutro(context: CanvasRenderingContext2D, progress: number, copy: FeatureDemoCopy) {
  const appear = ease(clamp(progress / 0.42));
  text(context, copy.outroTitle, 640, lerp(352, 326, appear), 64, palette.ink, 700, 'center');
  text(context, copy.outroSubtitle, 640, lerp(422, 398, appear), 24, palette.muted, 400, 'center');
  fillRoundRect(context, 492, 464, 296, 64, 16, palette.ink);
  text(context, copy.brand, 640, 507, 22, '#ffffff', 700, 'center');
}

const sceneDrawers: Record<
  FeatureDemoSceneId,
  (context: CanvasRenderingContext2D, progress: number, copy: FeatureDemoCopy) => void
> = {
  intro: drawIntro,
  thumbnailExpand: drawThumbnailExpand,
  thumbnailCollapse: drawThumbnailCollapse,
  codexImages: drawCodexImages,
  promptCompare: drawPromptCompare,
  videoDocument: drawVideoDocument,
  outro: drawOutro,
};

export function drawFeatureDemoFrame(context: CanvasRenderingContext2D, timeInSeconds: number, copy: FeatureDemoCopy) {
  const canvas = context.canvas;
  const scaleX = canvas.width / FEATURE_DEMO_PREVIEW_WIDTH;
  const scaleY = canvas.height / FEATURE_DEMO_PREVIEW_HEIGHT;
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.setTransform(scaleX, 0, 0, scaleY, 0, 0);
  context.fillStyle = palette.background;
  context.fillRect(0, 0, FEATURE_DEMO_PREVIEW_WIDTH, FEATURE_DEMO_PREVIEW_HEIGHT);

  const position = featureDemoSceneAt(timeInSeconds);
  sceneDrawers[position.scene.id](context, position.progress, copy);

  const edgeFade = Math.min(
    clamp(position.elapsed / 0.28),
    clamp((position.scene.durationInSeconds - position.elapsed) / 0.28),
  );
  if (edgeFade < 1) {
    context.fillStyle = `rgba(245,243,239,${1 - edgeFade})`;
    context.fillRect(0, 0, FEATURE_DEMO_PREVIEW_WIDTH, FEATURE_DEMO_PREVIEW_HEIGHT);
  }
  context.setTransform(1, 0, 0, 1, 0, 0);
}
