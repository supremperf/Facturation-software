import { useCallback, useEffect, useState, type AnchorHTMLAttributes } from 'react';

export interface RouteInfo {
  pathname: string;
  search: URLSearchParams;
  full: string;
}

function readLocation(): RouteInfo {
  const raw = window.location.hash.replace(/^#/, '') || '/';
  const index = raw.indexOf('?');
  const pathname = index >= 0 ? raw.slice(0, index) : raw;
  const search = new URLSearchParams(index >= 0 ? raw.slice(index + 1) : '');
  return { pathname: pathname || '/', search, full: raw };
}

export function navigate(to: string, options: { replace?: boolean } = {}): void {
  const target = `#${to.startsWith('/') ? to : `/${to}`}`;
  if (window.location.hash === target) return;
  if (options.replace) {
    const url = `${window.location.pathname}${window.location.search}${target}`;
    window.history.replaceState(null, '', url);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  } else {
    window.location.hash = target;
  }
}

export function useRoute(): RouteInfo {
  const [route, setRoute] = useState<RouteInfo>(readLocation);

  useEffect(() => {
    const onChange = () => setRoute(readLocation());
    window.addEventListener('hashchange', onChange);
    if (!window.location.hash) window.history.replaceState(null, '', `${window.location.pathname}#/`);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);

  return route;
}

export function useNavigate() {
  return useCallback((to: string) => navigate(to), []);
}

export function useQueryParams(): URLSearchParams {
  const route = useRoute();
  return route.search;
}

export function Link({
  to,
  children,
  className,
  onClick,
  ...rest
}: AnchorHTMLAttributes<HTMLAnchorElement> & { to: string }) {
  return (
    <a
      href={`#${to.startsWith('/') ? to : `/${to}`}`}
      className={className}
      onClick={(event) => {
        onClick?.(event);
      }}
      {...rest}
    >
      {children}
    </a>
  );
}
