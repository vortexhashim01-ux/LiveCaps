import { useEffect } from "react";
import { useThemeStore } from "../store/themeStore";

/**
 * Keeps the `dark` class on <html> in sync with the chosen theme.
 * WHY a hook: the class lives outside React (on the document element), so it
 * needs one effect that owns the DOM, plus a listener for OS theme changes.
 */
export function useApplyTheme(): void {
  const mode = useThemeStore((state) => state.mode);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");

    const apply = () => {
      const shouldBeDark = mode === "dark" || (mode === "system" && media.matches);
      document.documentElement.classList.toggle("dark", shouldBeDark);
    };

    apply();

    // Only "system" needs to react to the OS switching theme.
    if (mode !== "system") return;

    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [mode]);
}
