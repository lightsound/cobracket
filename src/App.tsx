import { createSignal } from "solid-js";
import OrganizerBadge from "./OrganizerBadge";
import Tasks from "./Tasks";
import ThemeToggle from "./ThemeToggle";
import { initAuth } from "./lib/auth";
import logo from "./logo.svg";
import "./theme.css";
import "./App.css";

export default function App() {
  // Session bootstrap belongs to the app root, not to whichever component
  // happens to render first: restores a returning Organizer's session and
  // keeps the shared Convex connection authenticated.
  initAuth();
  const [count, setCount] = createSignal(0);

  return (
    <header class="header">
      <h1 class="font-display text-4xl font-medium tracking-tight">🐍 cobracket</h1>
      <ThemeToggle />
      <OrganizerBadge />
      <img src={logo} class="logo" alt="Solid logo" />
      <p>
        Edit <code>src/App.tsx</code> and save to reload.
      </p>
      <button class="increment" type="button" onClick={() => setCount((c) => c + 1)}>
        Clicks: {count()}
      </button>
      <a class="link" href="https://v2.solidjs.com/" target="_blank" rel="noopener noreferrer">
        Learn Solid
      </a>
      <Tasks />
    </header>
  );
}
