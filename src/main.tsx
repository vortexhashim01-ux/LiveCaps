import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

const container = document.getElementById("root");

if (!container) {
  // A clear failure beats a blank white page.
  throw new Error('index.html is missing the <div id="root"></div> element.');
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
