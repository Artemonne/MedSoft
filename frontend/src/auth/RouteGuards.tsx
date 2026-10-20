import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { LoadingState } from '../components/PageFeedback';
import { useAuth } from './AuthContext';

export function RequireSubject({ subjectType }: { subjectType: 'admin' | 'user' }) {
  const { identity, isRestoring } = useAuth();
  const location = useLocation();
  if (isRestoring) return <LoadingState />;
  if (!identity) {
    return <Navigate to={subjectType === 'admin' ? '/admin/login' : '/login'} state={{ from: location }} replace />;
  }
  if (identity.subjectType !== subjectType) {
    return <Navigate to={identity.subjectType === 'admin' ? '/admin/medical-workers' : '/app/patients'} replace />;
  }
  return <Outlet />;
}

export function HomeRedirect() {
  const { identity, isRestoring } = useAuth();
  if (isRestoring) return <LoadingState />;
  if (identity?.subjectType === 'admin') return <Navigate to="/admin/medical-workers" replace />;
  if (identity?.subjectType === 'user') return <Navigate to="/app/patients" replace />;
  return <Navigate to="/login" replace />;
}
