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
