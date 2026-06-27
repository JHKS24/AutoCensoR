export const normalizeBackendBaseUrl = (value: string | undefined): string => {
  const raw = (value || '').trim();
  return raw.endsWith('/') ? raw.slice(0, -1) : raw;
};

export const backendBaseUrl = normalizeBackendBaseUrl(import.meta.env.VITE_AC_BACKEND_URL);

export const backendUrl = (path: string): string =>
  `${backendBaseUrl}${path.startsWith('/') ? path : `/${path}`}`;
