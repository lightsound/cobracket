// The one text field look, shared by NameField and DisciplineField so a
// change to it is one edit. Callers never restyle it (ADR 0012).
export function TextInput(props: {
  value: string;
  onInput: (value: string) => void;
  placeholder?: string;
  list?: string;
}) {
  return (
    <input
      class="rounded-md border border-ink-muted/40 bg-surface-raised px-3 py-2 text-base"
      required
      value={props.value}
      placeholder={props.placeholder}
      list={props.list}
      onInput={(event) => props.onInput(event.currentTarget.value)}
    />
  );
}
