/** Recupera solo un 404 al cargar el state del hilo guardado, sin alterar la respuesta del SDK. */
export function savedThreadFetch(
  apiUrl: string,
  threadId: string | null,
  onMissingThread: () => void,
  fetchImpl: typeof fetch = fetch,
): typeof fetch {
  const stateUrl = threadId ? `${apiUrl}/threads/${encodeURIComponent(threadId)}/state` : null;
  let loadingSavedThread = !!threadId;

  return async (input, init) => {
    const response = await fetchImpl(input, { ...init, credentials: 'include' });
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
    if (loadingSavedThread && url === stateUrl && method.toUpperCase() === 'GET') {
      if (response.ok) loadingSavedThread = false;
      else if (response.status === 404) {
        loadingSavedThread = false;
        onMissingThread();
      }
    }
    return response;
  };
}
