import { For, Loading, createUniqueId } from "solid-js";
import { api } from "../convex/_generated/api";
import { useI18n } from "./i18n";
import { createConvexQuery } from "./lib/convex";

// The freeform Discipline field with suggestions (story 2), shared by the
// create form and the tournament settings so both offer the same
// completions. Uncontrolled beyond `value`: the parent owns the signal.
export function DisciplineInput(props: {
  value: string;
  onInput: (value: string) => void;
  class: string;
}) {
  const { t } = useI18n();
  const listId = createUniqueId();
  const suggestions = createConvexQuery(api.operations.suggestDisciplines, () => ({
    prefix: props.value,
  }));

  return (
    <>
      <input
        class={props.class}
        required
        // A plain read, and no `latest()`: the boundary below owns its own
        // wait, so the parent's write is never held and there is no
        // uncommitted value to preview.
        value={props.value}
        placeholder={t("home.create.disciplinePlaceholder")}
        list={listId}
        onInput={(event) => props.onInput(event.currentTarget.value)}
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
    </>
  );
}
