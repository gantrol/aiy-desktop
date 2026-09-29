import { useId, useRef, useState } from 'react';
import { Button } from '@/renderer/components/ui/button';
import { Input } from '@/renderer/components/ui/input';
import { Label } from '@/renderer/components/ui/label';
import { Skeleton } from '@/renderer/components/ui/skeleton';
import { useI18n } from '@/renderer/i18n/useI18n';
import { ProfileAvatar } from '@/renderer/features/me/ProfileAvatar';
import { prepareProfileAvatar } from '@/renderer/features/me/profile-avatar';
import { useSpaceProfile } from '@/renderer/features/me/SpaceProfileProvider';
import type { UserProfile as Profile } from '@/shared/contracts/me';

export function UserProfile({ spaceName }: { spaceName: string }) {
  const copy = useI18n().messages.me;
  const { profile, failed, retry } = useSpaceProfile();
  return (
    <section className="space-y-8">
      <header className="flex items-baseline justify-between gap-4">
        <h1 className="text-xl font-semibold">{copy.profile}</h1>
        <span className="truncate text-sm text-muted-foreground">{spaceName}</span>
      </header>
      {failed ? (
        <div className="flex items-center gap-3">
          <span role="alert" className="text-sm text-destructive">
            {copy.profileFailed}
          </span>
          <Button variant="outline" onClick={retry}>
            {copy.refresh}
          </Button>
        </div>
      ) : profile ? (
        <ProfileForm profile={profile} />
      ) : (
        <Skeleton aria-label={copy.loading} className="h-52 w-full rounded-sm" />
      )}
    </section>
  );
}

function ProfileForm({ profile }: { profile: Profile }) {
  const copy = useI18n().messages.me;
  const { saving, save } = useSpaceProfile();
  const [draft, setDraft] = useState<Profile | null>(null);
  const [error, setError] = useState('');
  const [reading, setReading] = useState(false);
  const [saved, setSaved] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const id = useId();
  const value = draft ?? profile;
  const changed =
    value.authorName.trim() !== profile.authorName || (value.avatarDataUrl ?? null) !== (profile.avatarDataUrl ?? null);
  const busy = saving || reading;

  function edit(next: Profile) {
    setDraft(next);
    setSaved(false);
    setError('');
  }
  async function selectAvatar(file: File) {
    setReading(true);
    setError('');
    setSaved(false);
    try {
      edit({ ...value, avatarDataUrl: await prepareProfileAvatar(file) });
    } catch {
      setError(copy.avatarFailed);
    } finally {
      setReading(false);
    }
  }
  async function submit() {
    if (busy || !changed) return;
    setError('');
    setSaved(false);
    try {
      if (await save({ ...value, authorName: value.authorName.trim() })) {
        setDraft(null);
        setSaved(true);
      }
    } catch {
      setError(copy.saveFailed);
    }
  }
  return (
    <form
      className="space-y-6"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <div className="flex items-center gap-4">
        <ProfileAvatar src={value.avatarDataUrl} className="size-16" />
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" disabled={busy} onClick={() => fileInput.current?.click()}>
            {copy.changeAvatar}
          </Button>
          {value.avatarDataUrl && (
            <Button
              type="button"
              variant="ghost"
              disabled={busy}
              onClick={() => edit({ ...value, avatarDataUrl: null })}
            >
              {copy.removeAvatar}
            </Button>
          )}
        </div>
        <Input
          ref={fileInput}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          aria-label={copy.changeAvatar}
          disabled={busy}
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = '';
            if (file) void selectAvatar(file);
          }}
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor={id}>{copy.username}</Label>
        <Input
          id={id}
          value={value.authorName}
          maxLength={200}
          autoComplete="nickname"
          disabled={busy}
          onChange={(event) => edit({ ...value, authorName: event.target.value })}
        />
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="flex items-center gap-2">
        <Button type="submit" disabled={busy || !changed}>
          {saving ? copy.saving : copy.save}
        </Button>
        {draft && changed && (
          <Button
            type="button"
            variant="ghost"
            disabled={busy}
            onClick={() => {
              setDraft(null);
              setError('');
              setSaved(false);
            }}
          >
            {copy.cancel}
          </Button>
        )}
        {saved && (
          <span role="status" className="text-sm text-muted-foreground">
            {copy.saved}
          </span>
        )}
      </div>
    </form>
  );
}
