// Exported artwork has fixed colors; changing the application theme must not recolor a cover.
export const textCoverPalettes = {
  paper: { background: '#F3EFE5', ink: '#272923', accent: '#A2442F', soft: '#E7D6B8' },
  chalk: { background: '#F5F5EE', ink: '#29332A', accent: '#697654', soft: '#DCE2CA' },
  ink: { background: '#262923', ink: '#F5F0E3', accent: '#DCC478', soft: '#41463C' },
  sage: { background: '#DFE6D7', ink: '#284739', accent: '#9E4B34', soft: '#CDD8C3' },
  vermilion: { background: '#A13B29', ink: '#FFF4DF', accent: '#E2BD78', soft: '#8B3123' },
  butter: { background: '#F6E6A8', ink: '#37372D', accent: '#96713D', soft: '#E8CD78' },
  pine: { background: '#224638', ink: '#F6EEDD', accent: '#D7B96B', soft: '#355848' },
  blush: { background: '#F0E2D8', ink: '#563A35', accent: '#9C4735', soft: '#E2CAB9' },
} as const;
export type TextCoverPalette = keyof typeof textCoverPalettes;
