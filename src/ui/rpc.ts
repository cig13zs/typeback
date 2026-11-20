export interface RpcOk<T> {
  ok: true;
  data: T;
}

export interface RpcErr {
  ok: false;
  error: string;
}

export type Rpc<T> = RpcOk<T> | RpcErr;

function isRpc(value: unknown): value is Rpc<unknown> {
  return typeof value === 'object' && value !== null && 'ok' in value;
}

export async function rpc<T>(message: unknown): Promise<Rpc<T>> {
  try {
    const response: unknown = await chrome.runtime.sendMessage(message);
    if (isRpc(response)) return response as Rpc<T>;
    return { ok: false, error: 'Typeback did not answer.' };
  } catch {
    return { ok: false, error: 'Typeback is unavailable.' };
  }
}
