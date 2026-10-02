import type { ParentProps } from "solid-js";
import { I18nProvider } from "./i18n";
import { OrganizerProvider } from "./organizer";
import { ThemeProvider } from "./theme-preference";

/**
 * The app's provider stack — the one place shared, app-wide state is created.
 * One instance per mounted app: per browser tab, per SSR request.
 *
 * @public
 */
export function AppProviders(props: ParentProps) {
  return (
    <I18nProvider>
      <ThemeProvider>
        <OrganizerProvider>{props.children}</OrganizerProvider>
      </ThemeProvider>
    </I18nProvider>
  );
}
