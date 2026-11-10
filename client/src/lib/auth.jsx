import { useQuery } from '@tanstack/react-query';
import { Navigate, useLocation } from 'react-router';
import { api, setCsrfToken, ApiError } from './api.js';
import { Loading, LoadError } from '../components/ui.jsx';

/** The signed-in user, as the server sees them. Null when signed out. */
export function useMe() {
  return useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      try {
        const data = await api.get('/api/auth/me');
        setCsrfToken(data.csrfToken);
        return data.user;
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) return null;
        throw err;
      }
    },
    staleTime: 60_000,
    retry: false,
  });
}

export function RequireAuth({ children }) {
  const me = useMe();
  const location = useLocation();
  if (me.isPending) return <Loading label="Checking your sign-in" />;
  if (me.isError) {
    return (
      <div className="mx-auto max-w-lg p-8">
        <LoadError error={me.error} onRetry={() => me.refetch()} />
      </div>
    );
  }
  if (!me.data) return <Navigate to="/sign-in" replace state={{ from: location.pathname }} />;
  return children;
}

/** Does the user hold this access right (D108)? `perm` may be a list: any of them. */
export const can = (user, perm) =>
  (Array.isArray(perm) ? perm : [perm]).some((p) => Boolean(user?.perms?.includes(p)));

/** Hides a page the user's role does not open. The server enforces the same rule. */
export function RequirePerm({ perm, children }) {
  const me = useMe();
  if (!can(me.data, perm)) {
    return (
      <div className="max-w-xl">
        <h1 className="page-title">You don’t have access to this page</h1>
        <p className="mt-2 text-[0.9rem] text-muted">
          Your role doesn’t include it. If you need access, ask whoever manages Users in this module to change
          your role.
        </p>
      </div>
    );
  }
  return children;
}

/** Positions on the employee record (System Administrator, Department Manager, the directors). */
export const hasRole = (user, role) => Boolean(user?.roles?.includes(role));

/** Sees leave across the whole Altus Group: the group overview and group-wide reports. */
export const seesWholeGroup = (user) => can(user, 'leave.overview');
