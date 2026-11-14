import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Standard local development server (http://localhost:5173).
// The camera works on localhost even without HTTPS.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // WHY "::" instead of the default: on Windows the default binding can end
    // up IPv6-only (::1), so `http://127.0.0.1:5173` is refused even though the
    // server is running. "::" is dual-stack, so localhost, 127.0.0.1 and [::1]
    // all work. It also exposes the LAN address for phone testing.
    host: "::",
    port: 5173,
  },
});
