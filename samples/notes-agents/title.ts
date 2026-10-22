/** The first line of `text`, cut to a title's length; empty for empty text. Browser-safe. */
export function titleFrom(text: string): string {
  return (text.trim().split('\n')[0] ?? '').trim().slice(0, 60);
}
