/**
 * Shared sheet shell: bottom drawer on mobile (slides up, slides back down),
 * centered card on sm+ (scale in/out). Corners are concentric with the close
 * button: 12px inset + 16px button radius = 28px corner radius. Backdrop and close X are
 * part of the shell; it stays mounted while the exit animation plays.
 */
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { usePresence } from "./usePresence";

/** `bare`: no close button (the content has its own Cancel), and a handle on top on a phone, as Muse's input sheets. */
export function Sheet({
  open,
  onClose,
  children,
  bare = false,
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  bare?: boolean;
}) {
  const { mounted, closing, onAnimationEnd } = usePresence(open);
  if (!mounted) return null;
  // at the top of the page: inside another layer (settings, which animates and clips) a fixed sheet would be held to it
  return createPortal(
    <div
      className={`fixed inset-0 z-[80] flex items-end justify-center sm:items-center sm:p-4 ${closing ? "pointer-events-none" : ""}`}
    >
      <div
        className={`${closing ? "anim-fade-out" : "anim-fade-in"} absolute inset-0 bg-black/50`}
        onClick={onClose}
      />
      <div
        onAnimationEnd={onAnimationEnd}
        className={`${closing ? "anim-modal-out" : "anim-modal-in"} relative flex max-h-[92vh] w-full max-w-sm flex-col overflow-hidden rounded-t-[28px] sm:rounded-[28px]`}
        style={{
          background: "var(--chat-background)",
          boxShadow: "var(--shadow-sheet)",
        }}
      >
        {bare ? (
          <span
            aria-hidden
            className="mx-auto mt-2.5 h-1.5 w-10 shrink-0 rounded-full sm:hidden"
            style={{ background: "var(--fill-tertiary)" }}
          />
        ) : (
          <button
            aria-label="Close"
            className="absolute right-3 top-3 z-10 flex size-8 items-center justify-center rounded-full"
            style={{
              background: "var(--fill-secondary)",
              color: "var(--icon-primary)",
            }}
            onClick={onClose}
          >
            <X size={16} />
          </button>
        )}
        {children}
      </div>
    </div>,
    document.body,
  );
}
