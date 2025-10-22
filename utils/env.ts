export function env(key: string, fallback?: string): string {
  if (typeof process !== 'undefined' && process.env && key in process.env) {
    const value = process.env[key];
    if (value !== undefined) {
      return value;
    }
  }

  if (typeof import.meta !== 'undefined' && (import.meta as any).env && key in (import.meta as any).env) {
    const value = (import.meta as any).env[key];
    if (value !== undefined) {
      return value;
    }
  }

  if (fallback !== undefined) {
    return fallback;
  }

  return '';
}
