/** Compare dotted numeric versions (e.g. "0.1.0" vs "0.1.1-beta"). Returns -1/0/1. */
export function compareVersions(a: string, b: string): number {
  const parse = (value: string) => {
    const match = /^[vV]?(\d+)\.(\d+)\.(\d+)/.exec(value.trim());
    if (!match) return [0, 0, 0];
    return [Number(match[1]), Number(match[2]), Number(match[3])];
  };
  const left = parse(a);
  const right = parse(b);
  for (let index = 0; index < 3; index += 1) {
    if (left[index] > right[index]) return 1;
    if (left[index] < right[index]) return -1;
  }
  return 0;
}

export function isUpdateNewer(current: string, latest: string): boolean {
  return compareVersions(latest, current) > 0;
}
