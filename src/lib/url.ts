export function withBase(pathname: string, base: string = import.meta.env.BASE_URL) {
  const normalizedBase = base === '/' ? '' : `/${base.replace(/^\/+|\/+$/g, '')}`;
  const normalizedPath = pathname === '/' ? '' : `/${pathname.replace(/^\/+/, '')}`;
  return `${normalizedBase}${normalizedPath || '/'}`;
}
