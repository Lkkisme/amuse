/**
 * The app's one text button: a pill in four variants and two sizes, with its
 * states (hover, disabled, focus, touch target) in one place.
 *
 * - `primary` blue, `danger` red: the action a sheet is for (white text).
 * - `secondary` grey: an action inside a row or card. `onCard` is for one on a
 *   card's own grey (a chat card, a list's rows), which needs the lighter fill.
 * - `plain` text only: Cancel, and links such as "Show more".
 * - `tone` colours the text of a `secondary` or `plain` button: "danger" is the
 *   red of a destructive action in a row (a red label on the grey pill),
 *   "accent" the blue of a choice among others.
 * - `sm` (h-8) sits in a row, card or toolbar, as wide as its label; `lg`
 *   (h-12) is the full-width button at the bottom of a sheet.
 *
 * `className` is for where it goes (margin, width, flex), not for how it looks.
 * Icon-only buttons, switches and segmented controls are not this (see
 * button-guard.test.ts).
 */
import type { ComponentProps } from "react";

type Variant = "primary" | "danger" | "secondary" | "plain";
type Size = "sm" | "lg";
type Tone = "danger" | "accent";

const TEXT: Record<Tone, string> = {
  danger: "text-[var(--fill-red)]",
  accent: "text-[var(--fill-blue)]",
};

const SIZE: Record<Size, string> = {
  // the pseudo-element is the touch target: 4px more above and below, 40px in all
  sm: "relative h-8 px-4 text-[14px] font-medium before:absolute before:inset-x-0 before:-inset-y-1",
  lg: "h-12 w-full text-[16px] font-semibold",
};

function look(variant: Variant, tone: Tone | undefined, onCard: boolean): string {
  if (variant === "primary") return "bg-[var(--fill-blue)] text-white";
  if (variant === "danger") return "bg-[var(--fill-red)] text-white";
  const text = tone ? TEXT[tone] : "text-[var(--text-primary)]";
  if (variant === "plain") return text;
  return `${onCard ? "bg-[var(--fill-card-button)]" : "bg-[var(--fill-secondary)]"} ${text}`;
}

export function Button({
  variant = "secondary",
  size = "sm",
  tone,
  onCard = false,
  className = "",
  ...rest
}: Omit<ComponentProps<"button">, "style"> & {
  variant?: Variant;
  size?: Size;
  tone?: Tone;
  onCard?: boolean;
}) {
  return (
    <button
      {...rest}
      className={`hover-fade inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-full outline-offset-2 outline-[color:var(--fill-blue)] focus-visible:outline-2 disabled:opacity-40 ${SIZE[size]} ${look(variant, tone, onCard)} ${className}`}
    />
  );
}
