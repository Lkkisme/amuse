import { useEffect, useState } from "react";

/**
 * Keep a panel mounted while its exit animation plays.
 * open -> mounted; open goes false -> closing (play the exit class) -> unmounted
 * when the exit animation ends. Attach onAnimationEnd to the animated element.
 * `instant`: a close that has already played out (a swipe moved the panel away): it goes at once, with no exit.
 */
export function usePresence(open: boolean, instant = false) {
  const [mounted, setMounted] = useState(open);
  useEffect(() => {
    if (open) setMounted(true);
    else if (instant) setMounted(false);
  }, [open, instant]);
  const closing = mounted && !open && !instant;
  const onAnimationEnd = (e: React.AnimationEvent) => {
    // children animate too (fade-ins); only the panel's own exit counts
    if (closing && e.target === e.currentTarget) setMounted(false);
  };
  return { mounted: open || (mounted && !instant), closing, onAnimationEnd };
}

/** Last non-null value, so a closing panel can keep rendering what it showed. */
export function useLastValue<T>(value: T | null): T | null {
  const [last, setLast] = useState<T | null>(value);
  useEffect(() => {
    if (value !== null) setLast(value);
  }, [value]);
  return value ?? last;
}
