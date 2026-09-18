/** Selects the experiment transport explicitly before runner launch. @example selectBrowser('managed') // 'managed' */
export function selectBrowser(value: string | undefined): 'native' | 'managed' {
  if (value === undefined || value === 'native') return 'native';
  if (value === 'managed') return 'managed';
  throw new Error(`Unsupported browser backend: ${value}`);
}
