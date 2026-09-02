import { For, createUniqueId } from "solid-js";
import { t } from "./i18n";

export type FormatFamily = "single_elimination" | "double_elimination";

const FAMILIES: readonly FormatFamily[] = ["single_elimination", "double_elimination"];

// The Format choice (story 3), shared by the create form and the tournament
// settings. `disabled` renders the locked state once the structure is fixed.
export function FormatFieldset(props: {
  value: FormatFamily;
  onChange: (family: FormatFamily) => void;
  disabled?: boolean;
}) {
  // Radios group by name; a unique one keeps two forms on a page apart.
  const groupName = createUniqueId();

  return (
    <fieldset class="flex flex-col gap-1 text-sm" disabled={props.disabled ?? false}>
      <legend class="text-ink-muted">{t("home.create.format")}</legend>
      <div class="flex gap-4 pt-1">
        <For each={FAMILIES}>
          {(family) => (
            <label class={["flex items-center gap-2", { "opacity-60": props.disabled === true }]}>
              <input
                type="radio"
                name={groupName}
                checked={props.value === family}
                onInput={() => props.onChange(family)}
              />
              {t(`format.${family}`)}
            </label>
          )}
        </For>
      </div>
    </fieldset>
  );
}
