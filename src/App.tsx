import { Errored, Loading } from "solid-js";
import LocaleToggle from "./LocaleToggle";
import ThemeToggle from "./ThemeToggle";
import { errorFallback } from "./ErrorFallback";
import { t } from "./i18n";
import { initAuth } from "./lib/auth";
import { Router } from "./router";
import "./theme.css";

export default function App() {
  initAuth();

  return (
    <Router>
      {(props) => (
        <div class="mx-auto flex min-h-screen max-w-6xl flex-col gap-6 px-4 py-6">
          <header class="flex flex-wrap items-center justify-between gap-3">
            <a href={Router.paths()} class="font-display text-2xl font-medium tracking-tight">
              🐍 cobracket
            </a>
            <div class="flex gap-2">
              <LocaleToggle />
              <ThemeToggle />
            </div>
          </header>
          <main class="flex-1">
            <Errored fallback={errorFallback}>
              <Loading fallback={<p class="text-sm text-ink-muted">{t("app.loading")}</p>}>
                {props.children}
              </Loading>
            </Errored>
          </main>
        </div>
      )}
    </Router>
  );
}
