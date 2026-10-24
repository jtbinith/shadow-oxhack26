import { useAuth } from '@clerk/clerk-react'
import { useCallback } from 'react'

export type Stage = { stage: string; [k: string]: unknown }
export type Step = { type: 'learn' | 'chain'; eight_counts: number[]; start_speed: number; note?: string }
export type EightCount = {
  idx: number
  start_s: number
  end_s: number
  count_times: number[]
  repeat_of: number | null
  key_moments: { type: 'hit' | 'freeze'; count: number; t: number }[]
  difficulty: number
  moves?: { count: number; name: string }[] | null
  name?: string | null
}
export type Routine = {
  id: string
  title: string
  style?: string
  status: 'processing' | 'ready' | 'failed'
  error?: string | null
  stages: Stage[]
  tempo_bpm: number | null
  duration_s?: number | null
  beat_source?: string | null
  lesson_plan: { steps?: Step[]; summary?: string; source?: string }
  eight_counts: EightCount[]
  created_at: string
}

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

/** fetch() for our API with the Clerk session attached; throws ApiError with the server's message. */
export function useApi() {
  const { getToken } = useAuth()
  return useCallback(
    async <T,>(path: string, init: RequestInit = {}): Promise<T> => {
      const token = await getToken()
      const res = await fetch(path, { ...init, headers: { ...(init.headers ?? {}), Authorization: `Bearer ${token}` } })
      if (!res.ok) {
        let msg = res.statusText
        try {
          msg = (await res.json()).detail ?? msg
        } catch {
          /* not JSON */
        }
        throw new ApiError(res.status, msg)
      }
      return (res.status === 204 ? undefined : await res.json()) as T
    },
    [getToken],
  )
}
