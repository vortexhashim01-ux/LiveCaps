import { create } from "zustand";
import { persist } from "zustand/middleware";

export type ThemeMode = "system" | "light" | "dark";

interface ThemeState {
  mode: ThemeMode;
  /** system -> light -> dark -> system */
  cycle: () => void;
}

const ORDER: ThemeMode[] = ["system", "light", "dark"];

/**
 * Theme choice, remembered in localStorage under "moments.theme".
 * The same key is read by the inline script in index.html so the page does not
 * flash the wrong colours on load.
 */
export const useThemeStore = create<ThemeState>()(
  persist(
    (set, get) => ({
      mode: "system",
      cycle: () => {
        const index = ORDER.indexOf(get().mode);
        set({ mode: ORDER[(index + 1) % ORDER.length] });
      },
    }),
    { name: "moments.theme" },
  ),
);
