export function trimLeadingCharacters(value: string, characters: string) {
  let start = 0;
  while (start < value.length && characters.includes(value[start])) start += 1;
  return value.slice(start);
}

export function trimTrailingCharacters(value: string, characters: string) {
  let end = value.length;
  while (end > 0 && characters.includes(value[end - 1])) end -= 1;
  return value.slice(0, end);
}

export function trimSurroundingCharacters(value: string, characters: string) {
  let start = 0;
  let end = value.length;
  while (start < end && characters.includes(value[start])) start += 1;
  while (end > start && characters.includes(value[end - 1])) end -= 1;
  return value.slice(start, end);
}
