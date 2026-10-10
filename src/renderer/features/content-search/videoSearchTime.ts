export function formatVideoSearchTime(milliseconds: number, locale: string, precise = false) {
  const seconds = Math.floor(milliseconds / 1000);
  const part = (value: number) =>
    new Intl.NumberFormat(locale, { minimumIntegerDigits: 2, useGrouping: false }).format(value);
  const hours = Math.floor(seconds / 3600);
  const second = precise
    ? new Intl.NumberFormat(locale, {
        minimumIntegerDigits: 2,
        minimumFractionDigits: 3,
        maximumFractionDigits: 3,
        useGrouping: false,
      }).format((milliseconds % 60_000) / 1000)
    : part(seconds % 60);
  return `${hours ? `${part(hours)}:` : ''}${part(Math.floor(seconds / 60) % 60)}:${second}`;
}
