import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";
import { startedTo } from "./connection";

startedTo("the app's script ran");

// The keyboard should shrink the app, not push it up out of view. Chrome does so for
// interactive-widget=resizes-content (index.html); Safari ignores that, so follow the visible
// area by hand and keep the page from scrolling under it.
const visible = window.visualViewport;
if (visible) {
  const fit = () => {
    if (visible.scale > 1) return; // pinch zoom, not the keyboard
    document.documentElement.style.setProperty("--visible-height", `${visible.height}px`);
    window.scrollTo(0, 0);
  };
  visible.addEventListener("resize", fit);
  fit();
}

const root = document.getElementById("root");
if (!root) throw new Error("index.html has no #root element");

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
