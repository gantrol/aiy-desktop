import { useEffect, useId, useRef, useState } from 'react';
import { Button } from '@/renderer/components/ui/button';
import { Input } from '@/renderer/components/ui/input';
import { Label } from '@/renderer/components/ui/label';
import { Skeleton } from '@/renderer/components/ui/skeleton';
import { useI18n } from '@/renderer/i18n/useI18n';
import { ProfileAvatar } from '@/renderer/features/me/ProfileAvatar';
import { prepareProfileAvatar, profileAvatarAccept } from '@/renderer/features/me/profile-avatar';
import { useSpaceProfile } from '@/renderer/features/me/SpaceProfileProvider';
import type { UserProfile as Profile } from '@/shared/contracts/me';

export function UserProfile() {
  const copy = useI18n().messages.me;
  const { profile, failed, retry } = useSpaceProfile();
  const [editing, setEditing] = useState(false);
  const [saved, setSaved] = useState(false);
  const editButton = useRef<HTMLButtonElement>(null);
  const restoreFocus = useRef(false);
  useEffect(() => {
    if (!editing && restoreFocus.current) {
      restoreFocus.current = false;
      editButton.current?.focus({ preventScroll: true });
    }
  }, [editing]);

  function finishEditing(didSave: boolean) {
    setSaved(didSave);
    restoreFocus.current = true;
    setEditing(false);
  }
  return (
    <section aria-label={copy.profile} className="space-y-4">
      {failed && (
        <div className="flex flex-wrap items-center gap-3">
          <span role="alert" className="text-sm text-destructive">
            {copy.profileFailed}
          </span>
          <Button variant="outline" onClick={retry}>
            {copy.refresh}
          </Button>
        </div>
      )}
      {profile ? (
        editing ? (
          <ProfileForm profile={profile} onDone={finishEditing} />
        ) : (
          <div className="flex flex-wrap items-center gap-4">
            <ProfileAvatar src={profile.avatarDataUrl} className="size-16 shrink-0" />
            <h2 className="min-w-0 flex-1 break-words text-base font-medium">{profile.authorName || copy.title}</h2>
            <Button
              ref={editButton}
              type="button"
              variant="outline"
              onClick={() => {
                setSaved(false);
                setEditing(true);
              }}
            >
              {copy.editProfile}
            </Button>
          </div>
        )
      ) : !failed ? (
        <Skeleton aria-label={copy.loading} className="h-16 w-full rounded-sm" />
      ) : null}
      {saved && (
        <span role="status" className="block text-sm text-muted-foreground">
          {copy.saved}
        </span>
      )}
    </section>
  );
}

function ProfileForm({ profile, onDone }: { profile: Profile; onDone(saved: boolean): void }) {
  const copy = useI18n().messages.me;
  const { saving, save } = useSpaceProfile();
  const [draft, setDraft] = useState<Profile | null>(null);
  const [error, setError] = useState('');
  const [reading, setReading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const id = useId();
  const value = draft ?? profile;
  const changed =
    value.authorName.trim() !== profile.authorName || (value.avatarDataUrl ?? null) !== (profile.avatarDataUrl ?? null);
  const busy = saving || reading;

  function edit(next: Profile) {
    setDraft(next);
    setError('');
  }
  async function selectAvatar(file: File) {
    setReading(true);
    setError('');
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
    try {
      if (await save({ ...value, authorName: value.authorName.trim() })) {
        onDone(true);
      }
    } catch {
      setError(copy.saveFailed);
    }
  }
  return (
    <form
      className="space-y-5"
      aria-busy={busy}
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <div className="flex flex-wrap items-center gap-4">
        <ProfileAvatar src={value.avatarDataUrl} className="size-16 shrink-0" />
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
          accept={profileAvatarAccept}
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
          autoFocus
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
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" disabled={busy || !changed}>
          {saving ? copy.saving : copy.save}
        </Button>
        <Button type="button" variant="ghost" disabled={busy} onClick={() => onDone(false)}>
          {copy.cancel}
        </Button>
      </div>
    </form>
  );
}
