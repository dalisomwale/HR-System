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

/** Hides a page the user's roles do not allow. The server enforces the same rule. */
export function RequireRole({ role, children }) {
  const me = useMe();
  const allowed = Array.isArray(role) ? role : [role];
  if (!allowed.some((r) => me.data?.roles.includes(r))) {
    const who = { HR_OFFICER: 'HR Officers', HR_ADMIN: 'System Administrators' };
    return (
      <div className="max-w-xl">
        <h1 className="text-xl font-semibold">You don’t have access to this page</h1>
        <p className="mt-2 text-sm text-muted">
          It is available to {who[allowed[0]] ?? 'HR Officers and directors'}. If you need access, ask a
          System Administrator to grant you the role.
        </p>
      </div>
    );
  }
  return children;
}

export const hasRole = (user, role) => Boolean(user?.roles?.includes(role));

/** Roles that see leave across the whole company. Directors can look but not approve. */
export const GROUP_VIEW_ROLES = ['HR_OFFICER', 'EXECUTIVE_DIRECTOR', 'MANAGING_DIRECTOR'];
export const seesWholeGroup = (user) => GROUP_VIEW_ROLES.some((r) => hasRole(user, r));
