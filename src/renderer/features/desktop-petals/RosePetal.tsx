import { flowerPetalGeometry, flowerFoldPose, ROSE_CENTER, ROSE_OUTER_COUNT } from '@/shared/flower-geometry';

/** Fold-aware local materials and a fixed upper-left light, all expressed as native SVG. */
export function RosePaint({ id, fold = 0 }: { id: string; fold?: number }) {
  const outer = flowerFoldPose('outer', fold).curl;
  const inner = flowerFoldPose('inner', fold).curl;
  const center = flowerFoldPose('center', fold).height;
  const extent = 1 - 0.54 * outer;
  const light = (coordinate: number) => 100 + (coordinate - 100) * extent;
  const core = (coordinate: number) => 100 + (coordinate - 100) * center;
  return (
    <defs>
      <linearGradient
        id={id + '-outer'}
        x1="94"
        y1={12 + 47 * outer}
        x2="105"
        y2={110 + 10 * outer}
        gradientUnits="userSpaceOnUse"
      >
        <stop stopColor="#ef6e60" />
        <stop offset=".2" stopColor="#dd3940" />
        <stop offset=".46" stopColor="#c31d32" />
        <stop offset=".76" stopColor="#94142a" />
        <stop offset="1" stopColor="#5d1022" />
      </linearGradient>
      <linearGradient
        id={id + '-inner'}
        x1="92"
        y1={44 + 30 * inner}
        x2="107"
        y2={107 + 8 * inner}
        gradientUnits="userSpaceOnUse"
      >
        <stop stopColor="#ed695c" />
        <stop offset=".23" stopColor="#d9363d" />
        <stop offset=".58" stopColor="#ad1b30" />
        <stop offset="1" stopColor="#651024" />
      </linearGradient>
      <linearGradient
        id={id + '-outer-rim'}
        x1="90"
        y1={10 + 48 * outer}
        x2="98"
        y2={39 + 38 * outer}
        gradientUnits="userSpaceOnUse"
      >
        <stop stopColor="#fba58b" />
        <stop offset=".35" stopColor="#ed7365" />
        <stop offset=".78" stopColor="#ce3c43" />
        <stop offset="1" stopColor="#b52739" />
      </linearGradient>
      <linearGradient
        id={id + '-inner-rim'}
        x1="89"
        y1={42 + 30 * inner}
        x2="105"
        y2={65 + 21 * inner}
        gradientUnits="userSpaceOnUse"
      >
        <stop stopColor="#f8a08a" />
        <stop offset=".4" stopColor="#eb7365" />
        <stop offset="1" stopColor="#bb2d3c" />
      </linearGradient>
      <linearGradient
        id={id + '-cup'}
        x1={46 + 13 * outer}
        y1="75"
        x2={150 - 12 * outer}
        y2="87"
        gradientUnits="userSpaceOnUse"
      >
        <stop stopColor="#ffb39a" stopOpacity=".16" />
        <stop offset=".32" stopColor="#ffb39a" stopOpacity="0" />
        <stop offset=".68" stopColor="#540a20" stopOpacity="0" />
        <stop offset="1" stopColor="#540a20" stopOpacity=".32" />
      </linearGradient>
      <linearGradient
        id={id + '-direction'}
        x1={light(30)}
        y1={light(18)}
        x2={light(170)}
        y2={light(179)}
        gradientUnits="userSpaceOnUse"
      >
        <stop stopColor="#ffdcc0" stopOpacity=".15" />
        <stop offset=".43" stopColor="#ffdcc0" stopOpacity="0" />
        <stop offset="1" stopColor="#40091b" stopOpacity=".26" />
      </linearGradient>
      <radialGradient id={id + '-core'} cx={core(108)} cy={core(116)} r={45 * center} gradientUnits="userSpaceOnUse">
        <stop stopColor="#a33341" />
        <stop offset=".52" stopColor="#76182d" />
        <stop offset="1" stopColor="#400d20" />
      </radialGradient>
      <radialGradient id={id + '-recess'}>
        <stop offset=".55" stopColor="#50091f" stopOpacity="0" />
        <stop offset=".82" stopColor="#50091f" stopOpacity=".4" />
        <stop offset="1" stopColor="#50091f" stopOpacity="0" />
      </radialGradient>
      <filter id={id + '-contact'} x="-25%" y="-25%" width="150%" height="150%" colorInterpolationFilters="sRGB">
        <feGaussianBlur stdDeviation={1.15 * extent} />
      </filter>
      <clipPath id={id + '-outline'}>
        {Array.from({ length: ROSE_OUTER_COUNT }, (_, index) => (
          <path key={index} d={flowerPetalGeometry(index, fold).body} />
        ))}
      </clipPath>
    </defs>
  );
}

export function RosePetal({ paintId, index, fold = 0 }: { paintId: string; index: number; fold?: number }) {
  const { body, rim, kind, paintTransform } = flowerPetalGeometry(index, fold);
  const id = paintId + '-petal-' + index;
  const pose = flowerFoldPose(kind, fold);
  if (kind === 'center') {
    return (
      <>
        <circle
          cx={ROSE_CENTER.x}
          cy={ROSE_CENTER.y}
          r={ROSE_CENTER.radius * pose.height}
          fill={'url(#' + paintId + '-core)'}
        />
        <g transform={paintTransform} pointerEvents="none">
          <path
            d="M80 94C81 80 100 73 113 83C118 87 121 93 121 98C113 83 94 81 84 94C82 97 80 97 80 94Z"
            fill="#d24e50"
            opacity=".09"
          />
          <path
            d="M120 105C117 122 92 128 81 109C92 120 111 116 118 105C120 102 121 102 120 105Z"
            fill="#39081c"
            opacity=".1"
          />
        </g>
      </>
    );
  }
  const extent = 1 - 0.54 * pose.curl;
  return (
    <>
      <defs>
        <linearGradient id={id + '-surface'} href={'#' + paintId + '-' + kind} gradientTransform={paintTransform} />
        <linearGradient
          id={id + '-rim'}
          href={'#' + paintId + '-' + kind + '-rim'}
          gradientTransform={paintTransform}
        />
        <linearGradient id={id + '-cup'} href={'#' + paintId + '-cup'} gradientTransform={paintTransform} />
        <clipPath id={id + '-clip'}>
          <path d={body} />
        </clipPath>
      </defs>
      {index === ROSE_OUTER_COUNT && (
        <circle cx="100" cy="100" r={51 - 28 * pose.curl} fill={'url(#' + paintId + '-recess)'} pointerEvents="none" />
      )}
      <g clipPath={'url(#' + paintId + '-outline)'} pointerEvents="none">
        <path
          d={body}
          transform={'translate(0 ' + 1.2 * extent + ')'}
          fill="#40091b"
          opacity=".32"
          filter={'url(#' + paintId + '-contact)'}
        />
      </g>
      <path d={body} fill={'url(#' + id + '-surface)'} />
      <g clipPath={'url(#' + id + '-clip)'} pointerEvents="none">
        <path d={body} fill={'url(#' + id + '-cup)'} />
        <g opacity={1 - (kind === 'outer' ? 0.6 : 0.3) * pose.curl}>
          <path d={rim} transform={'translate(0 ' + 0.65 * extent + ')'} fill="#701126" opacity=".38" />
          <path d={rim} fill={'url(#' + id + '-rim)'} />
        </g>
        <path d={body} fill={'url(#' + paintId + '-direction)'} />
      </g>
    </>
  );
}
