import { For, Loading, createUniqueId } from "solid-js";
import { api } from "../convex/_generated/api";
import { t } from "./i18n";
import { createConvexQuery } from "./lib/convex";

// The freeform Discipline field with suggestions (story 2), shared by the
// create form and the tournament settings so both offer the same
// completions. Uncontrolled beyond `value`: the parent owns the signal.
export function DisciplineInput(props: {
  value: string;
  onInput: (value: string) => void;
  class: string;
}) {
  const listId = createUniqueId();
  const suggestions = createConvexQuery(api.operations.suggestDisciplines, () => ({
    prefix: props.value,
  }));

  return (
    <>
      <input
        class={props.class}
        required
        value={props.value}
        placeholder={t("home.create.disciplinePlaceholder")}
        list={listId}
        onInput={(event) => props.onInput(event.currentTarget.value)}
      />
      <datalist id={listId}>
        <Loading>
          <For each={suggestions()} keyed={(suggestion) => suggestion}>
            {(suggestion) => <option value={suggestion()} />}
          </For>
        </Loading>
      </datalist>
    </>
  );
}
