/**
 * The look: the system's (light or dark, following it as it changes), or one
 * the user picked, kept on this device. index.html sets it before the first
 * paint with the same rule, so a dark system never flashes light.
 */
export type Theme = "system" | "light" | "dark";
export const THEMES: Theme[] = ["system", "light", "dark"];

const KEY = "amuse.theme";
const dark = () => matchMedia("(prefers-color-scheme: dark)");

/** The user's pick on this device; the system's by default. */
export function storedTheme(): Theme {
  const kept = localStorage.getItem(KEY);
  return THEMES.find((t) => t === kept) ?? "system";
}

/** Keep the pick, and show it: the system's look follows the system from now on. Returns a cleanup. */
export function applyTheme(theme: Theme): () => void {
  localStorage.setItem(KEY, theme);
  const show = () => {
    const isDark = theme === "dark" || (theme === "system" && dark().matches);
    document.documentElement.classList.toggle("dark", isDark);
    document.documentElement.classList.toggle("light", !isDark);
  };
  show();
  if (theme !== "system") return () => {};
  const media = dark();
  media.addEventListener("change", show);
  return () => media.removeEventListener("change", show);
}
