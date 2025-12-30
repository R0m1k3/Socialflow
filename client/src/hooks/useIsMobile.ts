import { useState, useEffect } from 'react';

/**
 * Hook to detect if the user is on a mobile device
 * Uses both media query and user agent for robust detection
 *
 * @param breakpoint - The max-width breakpoint for mobile (default: 768px)
 * @returns boolean - true if mobile, false if desktop
 */
export function useIsMobile(breakpoint: number = 768): boolean {
  const [isMobile, setIsMobile] = useState<boolean>(() => {
    // Initial detection (SSR-safe)
    if (typeof window === 'undefined') return false;

    // Check media query
    const mediaMatch = window.matchMedia(`(max-width: ${breakpoint}px)`).matches;

    // Check user agent for mobile devices
    const userAgent = navigator.userAgent.toLowerCase();
    const mobileKeywords = ['android', 'webos', 'iphone', 'ipad', 'ipod', 'blackberry', 'windows phone'];
    const isUserAgentMobile = mobileKeywords.some(keyword => userAgent.includes(keyword));

    // Return true if either media query or user agent indicates mobile
    return mediaMatch || isUserAgentMobile;
  });

  useEffect(() => {
    // Create media query list
    const mediaQueryList = window.matchMedia(`(max-width: ${breakpoint}px)`);

    // Handler for media query changes
    const handleChange = (e: MediaQueryListEvent) => {
      setIsMobile(e.matches);
    };

    // Listen for changes (modern browsers)
    if (mediaQueryList.addEventListener) {
      mediaQueryList.addEventListener('change', handleChange);
    } else {
      // Fallback for older browsers
      mediaQueryList.addListener(handleChange);
    }

    // Cleanup
    return () => {
      if (mediaQueryList.removeEventListener) {
        mediaQueryList.removeEventListener('change', handleChange);
      } else {
        mediaQueryList.removeListener(handleChange);
      }
    };
  }, [breakpoint]);

  return isMobile;
}

/**
 * Hook to detect device type with more granularity
 * @returns object with device type information
 */
export function useDeviceType() {
  const isMobile = useIsMobile(768);
  const isTablet = useIsMobile(1024) && !useIsMobile(768);
  const isDesktop = !useIsMobile(1024);

  return {
    isMobile,
    isTablet,
    isDesktop,
    deviceType: isMobile ? 'mobile' : isTablet ? 'tablet' : 'desktop'
  } as const;
}
