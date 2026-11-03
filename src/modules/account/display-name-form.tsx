import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, Input } from "@/kit";

export function validName(value: string, min: number, max: number) {
  return (
    Array.from(value).length >= min &&
    Array.from(value).length <= max &&
    !/^\p{White_Space}|\p{White_Space}$/u.test(value) &&
    !/\p{Cc}/u.test(value)
  );
}

export function DisplayNameForm({
  initialName,
  pending,
  onSave,
}: {
  initialName: string;
  pending: boolean;
  onSave: (name: string) => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  const [invalid, setInvalid] = useState(false);
  return (
    <form
      noValidate
      className="max-w-md space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        const name = String(
          new FormData(event.currentTarget).get("displayName"),
        );
        const valid = validName(name, 0, 128);
        setInvalid(!valid);
        if (valid) onSave(name);
      }}
    >
      <label htmlFor={id} className="block space-y-2">
        <span>{t("account.profile.displayName")}</span>
        <Input
          id={id}
          name="displayName"
          defaultValue={initialName}
          disabled={pending}
          aria-invalid={invalid}
          aria-describedby={invalid ? `${id}-error` : undefined}
        />
      </label>
      {invalid && (
        <p id={`${id}-error`} role="alert">
          {t("errors.account.user.display_name_invalid")}
        </p>
      )}
      <Button type="submit" disabled={pending}>
        {t("account.profile.save")}
      </Button>
    </form>
  );
}
