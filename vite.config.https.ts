import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import basicSsl from "@vitejs/plugin-basic-ssl";

// Used by `npm run dev:https`.
// WHY: browsers only allow camera access on HTTPS or localhost. When you open
// the dev server from a phone over Wi-Fi (http://192.168.x.x) the camera is
// blocked, so this config serves a self-signed HTTPS certificate instead.
// Your phone will warn about the certificate once; accept it and continue.
export default defineConfig({
  plugins: [react(), tailwindcss(), basicSsl()],
  server: {
    host: true,
    port: 5173,
  },
});
