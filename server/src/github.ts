/** Asks GitHub who owns `token`. Returns null when GitHub rejects it; the token itself is never kept. */
export async function verifyGithubToken(
  token: string, fetchFn: typeof fetch,
): Promise<{ id: number; login: string } | null> {
  const res = await fetchFn('https://api.github.com/user', {
    headers: {
      Authorization: `Bearer ${token}`,
      'User-Agent': 'time-waster-server',
      Accept: 'application/vnd.github+json',
    },
    signal: AbortSignal.timeout(5000),
  });
  if (res.status !== 200) {
    await res.body?.cancel(); // free the connection instead of leaving the body unread
    return null;
  }
  const body = (await res.json()) as { id?: unknown; login?: unknown };
  if (typeof body.id !== 'number' || typeof body.login !== 'string') return null;
  return { id: body.id, login: body.login };
}
