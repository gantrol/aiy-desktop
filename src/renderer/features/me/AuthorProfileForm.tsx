import { useId, useRef, useState } from 'react';
import { Button } from '@/renderer/components/ui/button';
import { Input } from '@/renderer/components/ui/input';
import { Label } from '@/renderer/components/ui/label';
import { ProfileAvatar } from '@/renderer/features/me/ProfileAvatar';
import { prepareProfileAvatar } from '@/renderer/features/me/profile-avatar';
import { useI18n } from '@/renderer/i18n/useI18n';
import type { AuthorFields } from '@/shared/contracts/me';

export function AuthorProfileForm({
  initial,
  busy,
  onSave,
  onCancel,
}: {
  initial: AuthorFields;
  busy: boolean;
  onSave(fields: AuthorFields): Promise<boolean>;
  onCancel(): void;
}) {
  const copy = useI18n().messages.me;
  const [draft, setDraft] = useState(initial);
  const [reading, setReading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [avatarFailed, setAvatarFailed] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null),
    id = useId();
  return (
    <form
      className="grid gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (busy || reading || !draft.name.trim()) return;
        setFailed(false);
        void onSave({ ...draft, name: draft.name.trim() }).catch(() => setFailed(true));
      }}
    >
      <div className="flex items-center gap-2">
        <ProfileAvatar src={draft.avatarDataUrl} className="size-9" />
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={busy || reading}
          onClick={() => fileRef.current?.click()}
        >
          {copy.changeAvatar}
        </Button>
        {draft.avatarDataUrl && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={busy || reading}
            onClick={() => setDraft((value) => ({ ...value, avatarDataUrl: null }))}
          >
            {copy.removeAvatar}
          </Button>
        )}
        <Input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          aria-label={copy.changeAvatar}
          disabled={busy || reading}
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = '';
            if (!file) return;
            setReading(true);
            setAvatarFailed(false);
            void prepareProfileAvatar(file)
              .then(
                (avatarDataUrl) => setDraft((value) => ({ ...value, avatarDataUrl })),
                () => setAvatarFailed(true),
              )
              .finally(() => setReading(false));
          }}
        />
      </div>
      <Label htmlFor={id}>{copy.authorName}</Label>
      <Input
        id={id}
        value={draft.name}
        maxLength={200}
        disabled={busy || reading}
        onChange={(event) => setDraft((value) => ({ ...value, name: event.target.value }))}
      />
      {avatarFailed && (
        <span role="alert" className="text-xs text-destructive">
          {copy.avatarFailed}
        </span>
      )}
      {failed && (
        <span role="alert" className="text-xs text-destructive">
          {copy.authors.saveFailed}
        </span>
      )}
      <div className="flex justify-end gap-2">
        <Button type="button" size="sm" variant="ghost" disabled={busy || reading} onClick={onCancel}>
          {copy.cancel}
        </Button>
        <Button type="submit" size="sm" disabled={busy || reading || !draft.name.trim()}>
          {busy ? copy.saving : copy.save}
        </Button>
      </div>
    </form>
  );
}
