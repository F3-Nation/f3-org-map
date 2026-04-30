// API logic extracted from main.ts
const API_KEY = 'f3-org-map';
const CLIENT_HEADER = 'https://org.f3nation.com';

// Always use Vite's import.meta.env for API base
const API_BASE = import.meta.env.VITE_API_BASE || 'https://api.f3nation.com/v1';

export async function apiGet<T>(path: string, params?: Record<string, string | number | boolean | Array<string | number>>): Promise<T> {
  // Remove leading /v1 if present to avoid double /v1/v1
  const cleanPath = path.replace(/^\/v1\/?/, '/');
  const url = API_BASE ? new URL(`${API_BASE}${cleanPath}`) : new URL(cleanPath, window.location.origin);
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (Array.isArray(value)) {
        value.forEach((item, index) => {
          url.searchParams.append(`${key}[${index}]`, String(item));
        });
      } else {
        url.searchParams.set(key, String(value));
      }
    });
  }

  const response = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      client: CLIENT_HEADER
    }
  });

  if (!response.ok) {
    throw new Error(`API request failed: ${response.status} ${response.statusText}`);
  }

  return (await response.json()) as T;
}
