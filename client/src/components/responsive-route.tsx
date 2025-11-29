import { ComponentType, Suspense, lazy } from 'react';
import { useIsMobile } from '@/hooks/useIsMobile';

interface ResponsiveRouteProps {
  desktop: ComponentType<any>;
  mobile: ComponentType<any>;
  fallback?: React.ReactNode;
}

/**
 * ResponsiveRoute component that automatically switches between desktop and mobile versions
 * Uses lazy loading for optimal performance
 */
export function ResponsiveRoute({ desktop: Desktop, mobile: Mobile, fallback }: ResponsiveRouteProps) {
  const isMobile = useIsMobile();

  // Default loading fallback
  const defaultFallback = (
    <div className="flex items-center justify-center min-h-screen">
      <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
    </div>
  );

  return (
    <Suspense fallback={fallback || defaultFallback}>
      {isMobile ? <Mobile /> : <Desktop />}
    </Suspense>
  );
}

/**
 * Factory function to create lazy-loaded responsive routes
 * Usage:
 *   const Dashboard = createResponsiveRoute(
 *     () => import('./pages/dashboard'),
 *     () => import('./pages/mobile/dashboard')
 *   );
 */
export function createResponsiveRoute(
  desktopImport: () => Promise<{ default: ComponentType<any> }>,
  mobileImport: () => Promise<{ default: ComponentType<any> }>
) {
  const DesktopLazy = lazy(desktopImport);
  const MobileLazy = lazy(mobileImport);

  return function ResponsiveRouteWrapper() {
    return <ResponsiveRoute desktop={DesktopLazy} mobile={MobileLazy} />;
  };
}
