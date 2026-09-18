import { useSyncExternalStore } from "react";

// ── Design tokens — cinematic editorial, dark warm base, red as marker only ────
export const R = {
  bg:      "#080706",
  warm:    "#120e0a",
  border:  "#241c14",
  text:    "#f0ece5",
  muted:   "#84796c",
  red:     "#8B171A", // vermelho padrão da logo LOKAT.REC
  mono:    { fontFamily: "'Space Mono', monospace" } as React.CSSProperties,
  grotesk: { fontFamily: "'Space Grotesk', sans-serif" } as React.CSSProperties,
  // Headlines — Fredoka One (rounded, bold por natureza — não usar itálico, a família não tem esse estilo).
  display: { fontFamily: "'Fredoka One', sans-serif" } as React.CSSProperties,
};

function subscribeToResize(onChange: () => void) {
  window.addEventListener("resize", onChange);
  return () => window.removeEventListener("resize", onChange);
}

export function useIsMobile() {
  return useSyncExternalStore(
    subscribeToResize,
    () => window.innerWidth < 768 || navigator.maxTouchPoints > 0,
    () => false
  );
}

export function usePrefersReducedMotion() {
  return useSyncExternalStore(
    (onChange) => {
      const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    },
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    () => false
  );
}
