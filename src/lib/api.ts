export interface HealthResponse {
  ok: boolean
  service: string
  time: string
}

export async function getHealth(signal?: AbortSignal): Promise<HealthResponse> {
  const res = await fetch('/api/health', {
    signal,
    headers: { accept: 'application/json' },
  })
  if (!res.ok) {
    throw new Error(`API 请求失败：${res.status}`)
  }
  return (await res.json()) as HealthResponse
}
