import type React from 'react';

/** Standard glassmorphic card style used across all dashboard pages. */
export function appCardStyle(radius = 20, padding = '20px'): React.CSSProperties {
  return {
    background: 'linear-gradient(145deg, rgba(255,255,255,0.03) 0%, rgba(255,255,255,0.01) 100%)',
    border: '1px solid rgba(255,255,255,0.04)',
    borderRadius: radius,
    padding,
    boxShadow: 'inset 0 1px 0 0 rgba(255,255,255,0.12), inset 0 0 20px 0 rgba(255,255,255,0.01), 0 20px 40px -10px rgba(0,0,0,0.8)',
    backdropFilter: 'blur(24px)',
    transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
  };
}

/** Pro hero card with ambient gradient overlay. */
export function heroCardStyle(radius = 24, padding = '26px'): React.CSSProperties {
  return {
    ...appCardStyle(radius, padding),
    position: 'relative',
    overflow: 'hidden',
  };
}

/** Ambient glow overlay for hero cards (render as a child div). */
export const heroGlowStyle: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  background: 'radial-gradient(circle at top left, rgba(247,147,26,0.1), transparent 26%), radial-gradient(circle at top right, rgba(106,167,255,0.1), transparent 22%)',
  pointerEvents: 'none',
};
