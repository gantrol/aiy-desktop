export function contentImageNumber(value: number, numbering: string) {
  if (numbering !== 'chinese' || value < 1 || value > 100) return String(value);
  const digits = '零一二三四五六七八九';
  if (value < 10) return digits[value]!;
  if (value === 100) return '一百';
  const tens = Math.floor(value / 10),
    units = value % 10;
  return `${tens === 1 ? '' : digits[tens]}十${units ? digits[units] : ''}`;
}
