import { t } from "../i18n";
// fallow-ignore-next-line circular-dependency -- the official Solid Router 2 shape: the router lazy-imports pages (deferred dynamic import), pages link back through Router.paths; no init-order hazard
import { Router } from "../router";

export default function NotFound() {
  return (
    <div class="flex flex-col items-start gap-3">
      <p class="text-lg">{t("app.notFound")}</p>
      <a href={Router.paths()} class="text-sm text-accent underline">
        {t("app.backHome")}
      </a>
    </div>
  );
}
