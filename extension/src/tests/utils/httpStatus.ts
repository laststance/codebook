import { request } from 'node:http';

/** Preserves explicit Host headers for boundary tests, unlike Node fetch which replaces them. @example await httpStatus(url, {Host:'wrong'}, '{}') // 403 */
export async function httpStatus(url: string, headers: Record<string, string>, body: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const pending = request(url, { method: 'POST', headers }, response => {
      response.resume(); response.once('end', () => resolve(response.statusCode ?? 0)); response.once('error', reject);
    });
    pending.once('error', reject); pending.end(body);
  });
}
