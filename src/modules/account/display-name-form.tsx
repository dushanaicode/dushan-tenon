import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, FormField, Input } from "@/kit";

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
      <FormField
        label={t("account.profile.displayName")}
        error={
          invalid ? t("errors.account.user.display_name_invalid") : undefined
        }
      >
        {(control) => (
          <Input
            {...control}
            name="displayName"
            defaultValue={initialName}
            disabled={pending}
          />
        )}
      </FormField>
      <Button type="submit" disabled={pending}>
        {t("account.profile.save")}
      </Button>
    </form>
  );
}
