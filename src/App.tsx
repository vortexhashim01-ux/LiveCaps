import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { NavBar } from "./components/NavBar";
import { env } from "./config/env";
import { useApplyTheme } from "./hooks/useApplyTheme";
import Live from "./pages/Live";
import Gallery from "./pages/Gallery";
import PeoplePets from "./pages/PeoplePets";
import EnvApis from "./pages/EnvApis";
import Settings from "./pages/Settings";

export default function App() {
  useApplyTheme();

  return (
    <BrowserRouter>
      <div className="flex min-h-dvh flex-col bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
        <NavBar />

        <main className="flex-1">
          <Routes>
            <Route path="/" element={<Live />} />
            <Route path="/gallery" element={<Gallery />} />
            <Route path="/people" element={<PeoplePets />} />
            <Route path="/env" element={<EnvApis />} />
            <Route path="/settings" element={<Settings />} />
            {/* Unknown URLs go home instead of showing a blank page. */}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>

        <footer className="border-t border-slate-200 px-4 py-4 text-center text-xs text-slate-500 dark:border-slate-800 dark:text-slate-500">
          {env.appName} · Stages 1 + 4–6 · all processing happens on this device
        </footer>
      </div>
    </BrowserRouter>
  );
}
