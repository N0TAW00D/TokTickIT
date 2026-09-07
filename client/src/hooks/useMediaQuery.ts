import { useEffect, useState } from "react";

function getMatches(query: string): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  return window.matchMedia(query).matches;
}

/**
 * Subscribes to a CSS media query via `window.matchMedia`, so a component
 * can render exactly one of two layouts (e.g. My Tickets' table vs. card
 * list, ui-spec.md §9) rather than rendering both and hiding one with CSS —
 * that would duplicate every row for assistive tech and can't be verified
 * in jsdom, which applies no CSS at all.
 *
 * `client/tests/lab-02/MyTickets.test.tsx` stubs `window.matchMedia` to
 * drive this hook to both viewports.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => getMatches(query));

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }

    const mediaQueryList = window.matchMedia(query);
    setMatches(mediaQueryList.matches);

    const listener = (event: MediaQueryListEvent) => setMatches(event.matches);

    if (typeof mediaQueryList.addEventListener === "function") {
      mediaQueryList.addEventListener("change", listener);
      return () => mediaQueryList.removeEventListener("change", listener);
    }

    // Safari < 14 fallback (deprecated but still the only API there).
    mediaQueryList.addListener(listener);
    return () => mediaQueryList.removeListener(listener);
  }, [query]);

  return matches;
}
