import { For, Loading, createUniqueId } from "solid-js";
import { api } from "../convex/_generated/api";
import { useI18n } from "./i18n";
import { createConvexQuery } from "./lib/convex";
import { TextInput } from "./TextInput";

// The freeform Discipline field with suggestions (story 2), shared by the
// create form and the tournament settings so both offer the same label and
// completions. Uncontrolled beyond `value`: the parent owns the signal. It
// owns its look too: callers place it, they do not restyle it (ADR 0012).
export function DisciplineField(props: { value: string; onInput: (value: string) => void }) {
  const { t } = useI18n();
  const listId = createUniqueId();
  const suggestions = createConvexQuery(api.operations.suggestDisciplines, () => ({
    prefix: props.value,
  }));

  return (
    <label class="flex flex-col gap-1 text-sm">
      <span class="text-ink-muted">{t("home.create.discipline")}</span>
      <TextInput
        // A plain read, and no `latest()`: the boundary below owns its own
        // wait, so the parent's write is never held and there is no
        // uncommitted value to preview.
        value={props.value}
        onInput={(value) => props.onInput(value)}
        placeholder={t("home.create.disciplinePlaceholder")}
        list={listId}
      />
      <datalist id={listId}>
        {/*
          `on` is what keeps this a suggestions box rather than a gate on the
          field. Without it the boundary holds the write that caused the
          refetch — so every consumer of the parent's signal, including the
          form's submit handler, reads the value from before the keystroke,
          and a tournament gets created with the previous discipline while the
          screen shows the new one. With it the boundary handles the wait
          itself: the write commits at once, and the stale completions clear
          instead of being shown against a prefix nobody typed.
        */}
        <Loading on={props.value}>
          <For each={suggestions()} keyed={(suggestion) => suggestion}>
            {(suggestion) => <option value={suggestion()} />}
          </For>
        </Loading>
      </datalist>
    </label>
  );
}
