import { NavLink } from "react-router-dom";
import { env } from "../config/env";
import { useThemeStore } from "../store/themeStore";
import type { ThemeMode } from "../store/themeStore";

const LINKS = [
  { to: "/", label: "Live", end: true },
  { to: "/gallery", label: "Gallery", end: false },
  { to: "/people", label: "People & Pets", end: false },
  { to: "/env", label: "Environment", end: false },
  { to: "/settings", label: "Settings", end: false },
] as const;

const THEME_LABEL: Record<ThemeMode, string> = {
  system: "Theme: system. Switch to light",
  light: "Theme: light. Switch to dark",
  dark: "Theme: dark. Switch to system",
};

const THEME_ICON: Record<ThemeMode, string> = {
  system: "◐",
  light: "☀",
  dark: "☾",
};

export function NavBar() {
  const mode = useThemeStore((state) => state.mode);
  const cycle = useThemeStore((state) => state.cycle);

  return (
    <header className="sticky top-0 z-20 border-b border-slate-200/80 bg-white/85 backdrop-blur dark:border-slate-800/80 dark:bg-slate-950/85">
      {/*
        WHY full width and not a centered max-w container: the page content is
        centered at max-w-5xl, but the brand belongs in the actual top-left
        corner of the window. On a wide screen the old centered header pushed
        the logo ~200 px inwards, so it looked like it was sitting on top of
        the section links. Now the brand is always at the left edge, the
        sections sit on the right, and on narrow screens they wrap onto a
        second row.
      */}
      <div className="flex w-full flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
        {/*
          WHY two image files: the supplied logo is a flat PNG whose wordmark is
          white, so it only reads on a dark surface. logo-navy.png is the same
          artwork re-inked in the brand navy for the light theme, and CSS picks
          whichever file matches the active theme. Both are transparent, so the
          header background shows through instead of a dark plate.
        */}
        <NavLink
          to="/"
          className="order-1 mr-auto flex shrink-0 items-center"
          aria-label={`${env.appName} home`}
        >
          <img
            src="/logo-navy.png"
            alt=""
            draggable={false}
            className="h-7 w-auto sm:h-8 dark:hidden"
          />
          <img
            src="/logo-white.png"
            alt=""
            draggable={false}
            className="hidden h-7 w-auto sm:h-8 dark:block"
          />
        </NavLink>

        <button
          type="button"
          onClick={cycle}
          title={THEME_LABEL[mode]}
          aria-label={THEME_LABEL[mode]}
          className="order-2 grid size-9 shrink-0 place-items-center rounded-lg border border-slate-200 text-base text-slate-600 transition hover:bg-slate-100 md:order-3 md:size-10 md:text-lg dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
        >
          <span aria-hidden="true">{THEME_ICON[mode]}</span>
        </button>

        <nav aria-label="Main" className="order-3 w-full md:order-2 md:w-auto">
          <ul className="flex items-center gap-1 overflow-x-auto md:justify-end">
            {LINKS.map((link) => (
              <li key={link.to} className="shrink-0">
                <NavLink
                  to={link.to}
                  end={link.end}
                  className={({ isActive }) =>
                    `inline-block rounded-lg px-3 py-2 text-sm font-medium transition md:px-4 md:text-base ${
                      isActive
                        ? "bg-emerald-600/10 text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-400"
                        : "text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
                    }`
                  }
                >
                  {link.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </header>
  );
}
