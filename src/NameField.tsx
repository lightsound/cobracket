import { useI18n } from "./i18n";
import { TextInput } from "./TextInput";

// The tournament name field, shared by the create form and the tournament
// settings beside DisciplineField. Uncontrolled beyond `value`: the parent
// owns the signal, and the field owns its look (ADR 0012).
export function NameField(props: {
  value: string;
  onInput: (value: string) => void;
  placeholder?: string;
}) {
  const { t } = useI18n();
  return (
    <label class="flex flex-col gap-1 text-sm">
      <span class="text-ink-muted">{t("home.create.name")}</span>
      <TextInput
        value={props.value}
        onInput={(value) => props.onInput(value)}
        placeholder={props.placeholder}
      />
    </label>
  );
}
