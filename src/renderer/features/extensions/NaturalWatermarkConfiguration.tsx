import { useEffect, useMemo, useState } from 'react';
import { LoaderCircleIcon } from 'lucide-react';
import {
  naturalWatermarkConfigurationSchema,
  type NaturalWatermarkConfiguration,
  type NaturalWatermarkPosition,
  type NaturalWatermarkPreviewImage,
  type NaturalWatermarkProfile,
} from '@/shared/contracts/natural-watermark';
import { Button } from '@/renderer/components/ui/button';
import { NaturalWatermarkPreview } from '@/renderer/features/extensions/natural-watermark/NaturalWatermarkPreview';
import { NaturalWatermarkProfileEditor } from '@/renderer/features/extensions/natural-watermark/NaturalWatermarkProfileEditor';
import { NaturalWatermarkProfileList } from '@/renderer/features/extensions/natural-watermark/NaturalWatermarkProfileList';
import {
  cloneNaturalWatermarkConfiguration,
  createNaturalWatermarkProfile,
  duplicateNaturalWatermarkProfile,
  naturalWatermarkConfigurationFingerprint,
} from '@/renderer/features/extensions/natural-watermark-editor-model';
import { useI18n } from '@/renderer/i18n/useI18n';

interface CustomLogoPreview {
  id: string;
  url: string;
}

function duplicateProfileName(configuration: NaturalWatermarkConfiguration, profile: NaturalWatermarkProfile) {
  const name = profile.name.trim().toLowerCase();
  return (
    Boolean(name) &&
    configuration.profiles.some(
      (candidate) => candidate.id !== profile.id && candidate.name.trim().toLowerCase() === name,
    )
  );
}

export function NaturalWatermarkConfigurationPanel({
  active,
  notify,
}: {
  active: boolean;
  notify(message: string): void;
}) {
  const zh = useI18n().locale === 'zh';
  const [configuration, setConfiguration] = useState<NaturalWatermarkConfiguration | null>(null);
  const [savedFingerprint, setSavedFingerprint] = useState('');
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importingPreview, setImportingPreview] = useState(false);
  const [customLogoPreview, setCustomLogoPreview] = useState<CustomLogoPreview | null>(null);
  const [previewImage, setPreviewImage] = useState<NaturalWatermarkPreviewImage | null>(null);

  useEffect(() => {
    let current = true;
    void window.desktopApi
      .naturalWatermarkConfigurationGet()
      .then((value) => {
        if (!current) return;
        const loaded = cloneNaturalWatermarkConfiguration(value);
        setConfiguration(loaded);
        setSavedFingerprint(naturalWatermarkConfigurationFingerprint(loaded));
        setSelectedProfileId(loaded.preferredProfileId);
      })
      .catch((reason) => {
        if (current) notify(reason instanceof Error ? reason.message : String(reason));
      });
    return () => {
      current = false;
    };
  }, [notify]);

  useEffect(() => {
    let current = true;
    void window.desktopApi
      .naturalWatermarkPreviewImageGet()
      .then((image) => {
        if (current) setPreviewImage(image);
      })
      .catch((reason) => {
        if (current) notify(reason instanceof Error ? reason.message : String(reason));
      });
    return () => {
      current = false;
    };
  }, [notify]);

  const previewImageUrl = useMemo(
    () =>
      previewImage
        ? URL.createObjectURL(new Blob([Uint8Array.from(previewImage.bytes)], { type: previewImage.mimeType }))
        : null,
    [previewImage],
  );

  useEffect(
    () => () => {
      if (previewImageUrl) URL.revokeObjectURL(previewImageUrl);
    },
    [previewImageUrl],
  );

  const selectedProfile =
    configuration?.profiles.find(({ id }) => id === selectedProfileId) ?? configuration?.profiles[0] ?? null;
  const customLogoId = selectedProfile?.logo.kind === 'CUSTOM' ? selectedProfile.logo.id : null;

  useEffect(() => {
    let current = true;
    let objectUrl: string | null = null;
    setCustomLogoPreview(null);
    if (customLogoId) {
      void window.desktopApi
        .naturalWatermarkCustomLogoGet(customLogoId)
        .then((logo) => {
          objectUrl = URL.createObjectURL(new Blob([Uint8Array.from(logo.bytes)], { type: logo.mimeType }));
          if (current) setCustomLogoPreview({ id: customLogoId, url: objectUrl });
          else URL.revokeObjectURL(objectUrl);
        })
        .catch((reason) => {
          if (current) notify(reason instanceof Error ? reason.message : String(reason));
        });
    }
    return () => {
      current = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [customLogoId, notify]);

  if (!configuration || !selectedProfile) {
    return (
      <div className="grid h-24 place-items-center border-y">
        <LoaderCircleIcon className="size-4 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const draftConfiguration = configuration;
  const activeProfile = selectedProfile;
  const controlsDisabled = !active || saving || importing || importingPreview;
  const currentFingerprint = naturalWatermarkConfigurationFingerprint(draftConfiguration);
  const dirty = currentFingerprint !== savedFingerprint;
  const valid = naturalWatermarkConfigurationSchema.safeParse(draftConfiguration).success;
  const nameIsDuplicate = duplicateProfileName(draftConfiguration, activeProfile);
  const customLogoUrl = customLogoPreview?.id === customLogoId ? customLogoPreview.url : null;

  function updateSelectedProfile(profile: NaturalWatermarkProfile) {
    setConfiguration((current) =>
      current
        ? {
            ...current,
            profiles: current.profiles.map((candidate) => (candidate.id === profile.id ? profile : candidate)),
          }
        : current,
    );
  }

  function updateSelectedPosition(position: NaturalWatermarkPosition) {
    updateSelectedProfile({ ...activeProfile, position });
  }

  function createProfile() {
    const profile = createNaturalWatermarkProfile(draftConfiguration.profiles, zh ? '新水印' : 'Watermark');
    setConfiguration({ ...draftConfiguration, profiles: [...draftConfiguration.profiles, profile] });
    setSelectedProfileId(profile.id);
  }

  function duplicateProfile() {
    const profile = duplicateNaturalWatermarkProfile(draftConfiguration.profiles, activeProfile, zh ? '副本' : 'Copy');
    setConfiguration({ ...draftConfiguration, profiles: [...draftConfiguration.profiles, profile] });
    setSelectedProfileId(profile.id);
  }

  function deleteProfile() {
    if (draftConfiguration.profiles.length <= 1) return;
    const selectedIndex = draftConfiguration.profiles.findIndex(({ id }) => id === activeProfile.id);
    const profiles = draftConfiguration.profiles.filter(({ id }) => id !== activeProfile.id);
    const replacement = profiles[Math.min(selectedIndex, profiles.length - 1)];
    if (!replacement) return;
    setConfiguration({
      profiles,
      preferredProfileId:
        draftConfiguration.preferredProfileId === activeProfile.id
          ? replacement.id
          : draftConfiguration.preferredProfileId,
    });
    setSelectedProfileId(replacement.id);
  }

  async function importCustomLogo() {
    if (controlsDisabled) return;
    const profileId = activeProfile.id;
    setImporting(true);
    try {
      const logo = await window.desktopApi.naturalWatermarkCustomLogoImport();
      if (!logo) return;
      setConfiguration((current) =>
        current
          ? {
              ...current,
              profiles: current.profiles.map((profile) =>
                profile.id === profileId ? { ...profile, logo: { kind: 'CUSTOM', id: logo.id } } : profile,
              ),
            }
          : current,
      );
      notify(zh ? '已载入自定义标识' : 'Custom mark loaded');
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setImporting(false);
    }
  }

  async function importPreviewImage() {
    if (controlsDisabled) return;
    setImportingPreview(true);
    try {
      const image = await window.desktopApi.naturalWatermarkPreviewImageImport();
      if (!image) return;
      setPreviewImage(image);
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setImportingPreview(false);
    }
  }

  async function save() {
    if (controlsDisabled || !dirty || !valid) return;
    const candidate = draftConfiguration;
    setSaving(true);
    try {
      const saved = cloneNaturalWatermarkConfiguration(
        await window.desktopApi.naturalWatermarkConfigurationSave(candidate),
      );
      setConfiguration(saved);
      setSavedFingerprint(naturalWatermarkConfigurationFingerprint(saved));
      setSelectedProfileId((current) =>
        saved.profiles.some(({ id }) => id === current) ? current : saved.preferredProfileId,
      );
      notify(zh ? '水印方案已保存' : 'Watermark profiles saved');
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="overflow-hidden border-y">
      <NaturalWatermarkProfileList
        configuration={draftConfiguration}
        selectedProfileId={activeProfile.id}
        disabled={controlsDisabled}
        zh={zh}
        onSelect={setSelectedProfileId}
        onCreate={createProfile}
        onPrefer={(preferredProfileId) => setConfiguration({ ...draftConfiguration, preferredProfileId })}
        onDuplicate={duplicateProfile}
        onDelete={deleteProfile}
      />
      <div className="grid min-w-0 content-start gap-5 p-4">
        <NaturalWatermarkPreview
          key={activeProfile.id}
          profile={activeProfile}
          customLogoUrl={customLogoUrl}
          disabled={controlsDisabled}
          importingPreview={importingPreview}
          previewImageUrl={previewImageUrl}
          zh={zh}
          onImportPreview={() => void importPreviewImage()}
          onPositionChange={updateSelectedPosition}
        />
        <NaturalWatermarkProfileEditor
          profile={activeProfile}
          disabled={controlsDisabled}
          importing={importing}
          duplicateName={nameIsDuplicate}
          zh={zh}
          onChange={updateSelectedProfile}
          onImportLogo={() => void importCustomLogo()}
        />
        <div className="flex justify-end border-t pt-4">
          <Button type="button" size="sm" disabled={controlsDisabled || !dirty || !valid} onClick={() => void save()}>
            {saving && <LoaderCircleIcon className="size-3.5 animate-spin" />}
            {zh ? '保存' : 'Save'}
          </Button>
        </div>
      </div>
    </section>
  );
}
