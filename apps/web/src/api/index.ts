// Typed API client — thin wrapper over fetch that maps every backend endpoint.
// All types match the Fastify backend responses exactly (apps/api/src/routes/).

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

// ─── Domain types ────────────────────────────────────────────────────────────

export interface User {
  id: string
  email: string
  username: string
  displayName: string
}

export interface Sheet {
  id: string
  ownerId: string
  title: string
  instrument: 'guitar' | 'piano'
  visibility: 'private' | 'public'
  status: 'pending' | 'processing' | 'ready' | 'failed'
  transcriptionId: string | null
  audioPath: string
  tags: string[]
  createdAt: string
  deletedAt: string | null
  owner?: { username: string; displayName: string }
}

export interface Pagination {
  page: number
  limit: number
  total: number
  pages: number
}

export interface BlogPostMeta {
  slug: string
  title: string
  date: string | null
  excerpt: string | null
  author: string | null
}

export interface BlogPostFull extends BlogPostMeta {
  content: string
}

export interface ProfileUser {
  id: string
  username: string
  displayName: string
  createdAt: string
}

// ─── Core fetch wrapper ───────────────────────────────────────────────────────

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {}

  // Copy caller-provided headers
  if (init?.headers) {
    const h = init.headers
    if (h instanceof Headers) {
      h.forEach((v, k) => { headers[k] = v })
    } else if (Array.isArray(h)) {
      for (const [k, v] of h) { headers[k] = v }
    } else {
      Object.assign(headers, h)
    }
  }

  // Auto-set JSON Content-Type only for plain string bodies
  if (typeof init?.body === 'string' && !headers['content-type'] && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json'
  }

  const res = await fetch(path, {
    credentials: 'include',
    ...init,
    headers,
  })

  const ct = res.headers.get('content-type') ?? ''
  if (!ct.includes('application/json')) {
    if (!res.ok) throw new ApiError(res.status, 'HTTP_ERROR', res.statusText)
    return res as unknown as T
  }

  const body = (await res.json()) as Record<string, unknown>
  if (!res.ok) {
    const err = (body['error'] as Record<string, string> | undefined) ?? {}
    throw new ApiError(res.status, err['code'] ?? 'UNKNOWN', err['message'] ?? 'Request failed')
  }
  return body as T
}

// ─── Auth ─────────────────────────────────────────────────────────────────────

export const apiMe = () =>
  request<{ user: User }>('/api/me')

export const apiLogin = (email: string, password: string) =>
  request<{ user: User }>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  })

export const apiSignup = (data: {
  email: string
  username: string
  password: string
  displayName: string
}) =>
  request<{ user: User }>('/api/auth/signup', {
    method: 'POST',
    body: JSON.stringify(data),
  })

export const apiLogout = () =>
  request<{ success: boolean }>('/api/auth/logout', { method: 'POST' })

// ─── Sheets ───────────────────────────────────────────────────────────────────

export const apiListSheets = (page = 1, limit = 20, status?: string) => {
  const qs = new URLSearchParams({ page: String(page), limit: String(limit) })
  if (status) qs.set('status', status)
  return request<{ sheets: Sheet[]; pagination: Pagination }>(`/api/sheets?${qs}`)
}

export const apiUploadSheet = (formData: FormData) =>
  // No Content-Type header — browser sets multipart/form-data with boundary
  request<{ sheetId: string; jobId: string }>('/api/sheets/upload', {
    method: 'POST',
    body: formData,
  })

export const apiGetSheet = (id: string) =>
  request<{ sheet: Sheet; svg: string | null }>(`/api/sheets/${id}`)

export const apiUpdateSheet = (
  id: string,
  data: { title?: string; visibility?: 'private' | 'public'; tags?: string[] },
) =>
  request<{ sheet: Sheet }>(`/api/sheets/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  })

export const apiDeleteSheet = (id: string) =>
  request<{ success: boolean }>(`/api/sheets/${id}`, { method: 'DELETE' })

export const apiListPublicSheets = (page = 1, limit = 12) =>
  request<{ sheets: Sheet[]; pagination: Pagination }>(
    `/api/sheets/public?page=${page}&limit=${limit}`,
  )

export const apiGetPublicSheet = (id: string) =>
  request<{ sheet: Sheet; svg: string | null }>(`/api/sheets/public/${id}`)

// Build a download URL for a sheet artifact — used as href in <a> tags.
// The session cookie is sent automatically by the browser (same-origin).
export const downloadUrl = (sheetId: string, format: 'musicxml' | 'midi' | 'pdf' | 'svg') =>
  `/api/sheets/${sheetId}/download/${format}`

// ─── Blog ─────────────────────────────────────────────────────────────────────

export const apiListBlog = () =>
  request<{ posts: BlogPostMeta[] }>('/api/blog')

export const apiGetBlogPost = (slug: string) =>
  request<{ post: BlogPostFull }>(`/api/blog/${slug}`)

// ─── Profile ─────────────────────────────────────────────────────────────────

export const apiGetProfile = (username: string) =>
  request<{ user: ProfileUser; sheets: Sheet[] }>(`/api/u/${username}`)
