import { describe, expect, it, vi } from 'vitest';
import { savedThreadFetch } from './agent-thread';

const apiUrl = 'http://localhost:8000/api/agent';
const stateUrl = `${apiUrl}/threads/saved-thread/state`;

describe('savedThreadFetch', () => {
  it('reinicia el hilo guardado si su carga devuelve 404 y conserva el fetch con cookie', async () => {
    const onMissingThread = vi.fn();
    const response = new Response(null, { status: 404 });
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(response);
    const fetchThread = savedThreadFetch(apiUrl, 'saved-thread', onMissingThread, fetchImpl);

    expect(await fetchThread(stateUrl)).toBe(response);
    expect(onMissingThread).toHaveBeenCalledOnce();
    expect(fetchImpl).toHaveBeenCalledWith(stateUrl, { credentials: 'include' });
  });

  it.each([200, 401, 403, 500, 503])('no reinicia ni altera una respuesta %s', async (status) => {
    const onMissingThread = vi.fn();
    const response = new Response(null, { status });
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(response);
    const fetchThread = savedThreadFetch(apiUrl, 'saved-thread', onMissingThread, fetchImpl);

    expect(await fetchThread(new Request(stateUrl))).toBe(response);
    expect(onMissingThread).not.toHaveBeenCalled();
  });

  it('no recupera un 404 de otro hilo ni de otra operación', async () => {
    const onMissingThread = vi.fn();
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 404 }));
    const fetchThread = savedThreadFetch(apiUrl, 'saved-thread', onMissingThread, fetchImpl);

    await fetchThread(`${apiUrl}/threads/other-thread/state`);
    await fetchThread(`${apiUrl}/threads/saved-thread/commands`, { method: 'POST' });
    await fetchThread(stateUrl, { method: 'POST' });
    expect(onMissingThread).not.toHaveBeenCalled();
  });

  it('no reinicia un hilo que desaparece después de haber cargado correctamente', async () => {
    const onMissingThread = vi.fn();
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 404 }));
    const fetchThread = savedThreadFetch(apiUrl, 'saved-thread', onMissingThread, fetchImpl);

    await fetchThread(new URL(stateUrl));
    await fetchThread(stateUrl);
    expect(onMissingThread).not.toHaveBeenCalled();
  });

  it('recupera un 404 en un reintento de la carga inicial', async () => {
    const onMissingThread = vi.fn();
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(new Response(null, { status: 404 }));
    const fetchThread = savedThreadFetch(apiUrl, 'saved-thread', onMissingThread, fetchImpl);

    expect((await fetchThread(stateUrl)).status).toBe(503);
    expect(onMissingThread).not.toHaveBeenCalled();
    expect((await fetchThread(stateUrl)).status).toBe(404);
    expect(onMissingThread).toHaveBeenCalledOnce();
  });

  it('propaga los errores de conexión sin reiniciar el hilo', async () => {
    const onMissingThread = vi.fn();
    const error = new TypeError('Failed to fetch');
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(error);
    const fetchThread = savedThreadFetch(apiUrl, 'saved-thread', onMissingThread, fetchImpl);

    await expect(fetchThread(stateUrl)).rejects.toBe(error);
    expect(onMissingThread).not.toHaveBeenCalled();
  });
});
