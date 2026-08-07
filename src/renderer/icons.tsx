import type { SVGProps } from 'react';
import { BookTextIcon } from 'lucide-react';

const Icon = ({ children, ...props }: SVGProps<SVGSVGElement>) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.7"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    {...props}
  >
    {children}
  </svg>
);
export const DictionaryIcon = (props: SVGProps<SVGSVGElement>) => (
  <BookTextIcon aria-hidden="true" strokeWidth={1.7} {...props} />
);
export const HeartIcon = (props: SVGProps<SVGSVGElement>) => (
  <Icon {...props}>
    <path d="M20.8 5.8a5.3 5.3 0 0 0-7.5 0L12 7.1l-1.3-1.3a5.3 5.3 0 0 0-7.5 7.5L12 22l8.8-8.7a5.3 5.3 0 0 0 0-7.5Z" />
  </Icon>
);
export const RealityIcon = (props: SVGProps<SVGSVGElement>) => (
  <Icon {...props}>
    <circle cx="12" cy="12" r="7" />
  </Icon>
);
export const SearchIcon = (props: SVGProps<SVGSVGElement>) => (
  <Icon {...props}>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-4-4" />
  </Icon>
);
export const FilterIcon = (props: SVGProps<SVGSVGElement>) => (
  <Icon {...props}>
    <path d="M4 6h16M7 12h10M10 18h4" />
  </Icon>
);
export const PlusIcon = (props: SVGProps<SVGSVGElement>) => (
  <Icon {...props}>
    <path d="M12 5v14M5 12h14" />
  </Icon>
);
export const UploadIcon = (props: SVGProps<SVGSVGElement>) => (
  <Icon {...props}>
    <path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5" />
    <path d="M4 15v4h16v-4" />
  </Icon>
);
export const MessageIcon = (props: SVGProps<SVGSVGElement>) => (
  <Icon {...props}>
    <path d="M4 5h16v11H9l-5 4V5Z" />
  </Icon>
);
export const AgentRobotIcon = (props: SVGProps<SVGSVGElement>) => (
  <Icon data-icon="agent-robot" {...props}>
    <path d="M12 5V3" />
    <circle cx="12" cy="2.5" r=".75" fill="currentColor" stroke="none" />
    <rect x="4" y="6" width="16" height="14" rx="3.5" />
    <path d="M4 11H2.5v5H4M20 11h1.5v5H20" />
    <circle cx="9" cy="12" r="1" fill="currentColor" stroke="none" />
    <circle cx="15" cy="12" r="1" fill="currentColor" stroke="none" />
    <path d="M9 16c.8.7 1.8 1 3 1s2.2-.3 3-1" />
  </Icon>
);
export const ImageIcon = (props: SVGProps<SVGSVGElement>) => (
  <Icon {...props}>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <circle cx="9" cy="10" r="2" />
    <path d="m21 15-5-5L5 20" />
  </Icon>
);
export const PointIcon = (props: SVGProps<SVGSVGElement>) => (
  <Icon {...props}>
    <circle cx="12" cy="12" r="3" />
    <path d="M12 3v4M12 17v4M3 12h4M17 12h4" />
  </Icon>
);
export const RectIcon = (props: SVGProps<SVGSVGElement>) => (
  <Icon {...props}>
    <rect x="4" y="5" width="16" height="14" rx="1" />
  </Icon>
);
export const CloseIcon = (props: SVGProps<SVGSVGElement>) => (
  <Icon {...props}>
    <path d="m6 6 12 12M18 6 6 18" />
  </Icon>
);
export const FolderIcon = (props: SVGProps<SVGSVGElement>) => (
  <Icon {...props}>
    <path d="M3 6h7l2 2h9v11H3V6Z" />
  </Icon>
);
export const AlbumGlyphIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    {...props}
  >
    <path d="M7.5 4.5h8.25a2.75 2.75 0 0 1 2.75 2.75v8.5a2.75 2.75 0 0 1-2.75 2.75H7.5z" opacity=".38" />
    <rect x="4.5" y="6.5" width="13" height="13" rx="3" fill="currentColor" opacity=".12" />
    <rect x="4.5" y="6.5" width="13" height="13" rx="3" />
    <path d="M8 7v12" opacity=".55" />
    <path
      d="M12.75 10.1c.35 1.15.95 1.75 2.1 2.1-1.15.35-1.75.95-2.1 2.1-.35-1.15-.95-1.75-2.1-2.1 1.15-.35 1.75-.95 2.1-2.1Z"
      fill="currentColor"
      strokeWidth="1.15"
    />
  </svg>
);
