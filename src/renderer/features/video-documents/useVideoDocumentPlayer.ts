import { useCallback, useEffect, useRef, useState, type RefObject, type SyntheticEvent } from 'react';

interface UseVideoDocumentPlayerOptions {
  sourceId: string;
  fallbackDurationMs: number;
  audioEnabled: boolean;
  enabled?: boolean;
  onPlaybackTimeChange?(timestampMs: number): void;
  onPlaybackStateChange?(playing: boolean): void;
  onPlaybackError?(error: unknown): void;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function isTextEntryTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(target.closest('input, textarea, select, [contenteditable="true"]'));
}

interface PlayerDisplayModeOptions {
  sourceId: string;
  playerRef: RefObject<HTMLDivElement | null>;
  videoRef: RefObject<HTMLVideoElement | null>;
  onPlaybackError?(error: unknown): void;
}

function usePlayerDisplayModes({ sourceId, playerRef, videoRef, onPlaybackError }: PlayerDisplayModeOptions) {
  const [pictureInPicture, setPictureInPicture] = useState(false);
  const [nativeFullscreen, setNativeFullscreen] = useState(false);
  const [fallbackFullscreen, setFallbackFullscreen] = useState(false);
  const [canPictureInPicture, setCanPictureInPicture] = useState(false);

  const togglePictureInPicture = useCallback(async () => {
    const video = videoRef.current;
    if (!video || !canPictureInPicture) return;
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture();
      else await video.requestPictureInPicture();
    } catch (error) {
      onPlaybackError?.(error);
    }
  }, [canPictureInPicture, onPlaybackError, videoRef]);

  const toggleFullscreen = useCallback(async () => {
    if (fallbackFullscreen || document.fullscreenElement) {
      setFallbackFullscreen(false);
      if (document.fullscreenElement) await document.exitFullscreen().catch(() => undefined);
      return;
    }
    setFallbackFullscreen(true);
    const player = playerRef.current;
    if (!player || typeof player.requestFullscreen !== 'function') return;
    await player.requestFullscreen().catch(() => undefined);
  }, [fallbackFullscreen, playerRef]);

  useEffect(() => {
    setFallbackFullscreen(false);
    const video = videoRef.current;
    setCanPictureInPicture(Boolean(video?.requestPictureInPicture && document.pictureInPictureEnabled !== false));
  }, [sourceId, videoRef]);

  useEffect(() => {
    const onFullscreenChange = () => {
      const active = document.fullscreenElement === playerRef.current;
      setNativeFullscreen(active);
      if (!document.fullscreenElement) setFallbackFullscreen(false);
    };
    const video = videoRef.current;
    const onEnterPictureInPicture = () => setPictureInPicture(true);
    const onLeavePictureInPicture = () => setPictureInPicture(false);
    document.addEventListener('fullscreenchange', onFullscreenChange);
    video?.addEventListener('enterpictureinpicture', onEnterPictureInPicture);
    video?.addEventListener('leavepictureinpicture', onLeavePictureInPicture);
    return () => {
      document.removeEventListener('fullscreenchange', onFullscreenChange);
      video?.removeEventListener('enterpictureinpicture', onEnterPictureInPicture);
      video?.removeEventListener('leavepictureinpicture', onLeavePictureInPicture);
    };
  }, [playerRef, sourceId, videoRef]);

  useEffect(() => {
    if (!fallbackFullscreen) return undefined;
    const previousOverflow = document.body.style.overflow;
    const leaveFallbackFullscreen = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setFallbackFullscreen(false);
    };
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', leaveFallbackFullscreen);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', leaveFallbackFullscreen);
    };
  }, [fallbackFullscreen]);

  return {
    pictureInPicture,
    fullscreen: nativeFullscreen || fallbackFullscreen,
    fallbackFullscreen,
    canPictureInPicture,
    togglePictureInPicture,
    toggleFullscreen,
  };
}

export function useVideoDocumentPlayer({
  sourceId,
  fallbackDurationMs,
  audioEnabled,
  enabled = true,
  onPlaybackTimeChange,
  onPlaybackStateChange,
  onPlaybackError,
}: UseVideoDocumentPlayerOptions) {
  const playerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const onPlaybackTimeChangeRef = useRef(onPlaybackTimeChange);
  const lastAudibleVolumeRef = useRef(1);
  const [playing, setPlaying] = useState(false);
  const [currentTimeMs, setCurrentTimeMs] = useState(0);
  const [durationMs, setDurationMs] = useState(fallbackDurationMs);
  const [volume, setVolumeState] = useState(1);
  const [muted, setMutedState] = useState(!audioEnabled);
  const [playbackRate, setPlaybackRateState] = useState(1);
  const displayModes = usePlayerDisplayModes({ sourceId, playerRef, videoRef, onPlaybackError });
  const toggleFullscreen = displayModes.toggleFullscreen;

  useEffect(() => {
    onPlaybackTimeChangeRef.current = onPlaybackTimeChange;
  }, [onPlaybackTimeChange]);

  const reportTime = useCallback((timestampMs: number) => {
    const normalized = Math.max(0, Math.round(timestampMs));
    setCurrentTimeMs(normalized);
    onPlaybackTimeChangeRef.current?.(normalized);
  }, []);

  const syncDuration = useCallback(
    (video: HTMLVideoElement) => {
      const detectedDurationMs = Number.isFinite(video.duration) && video.duration > 0 ? video.duration * 1_000 : 0;
      setDurationMs(Math.round(detectedDurationMs || fallbackDurationMs));
    },
    [fallbackDurationMs],
  );

  const seekToMs = useCallback(
    (timestampMs: number) => {
      const video = videoRef.current;
      const upperBoundMs =
        video && Number.isFinite(video.duration) && video.duration > 0
          ? video.duration * 1_000
          : Math.max(durationMs, fallbackDurationMs);
      const nextTimestampMs = clamp(timestampMs, 0, Math.max(0, upperBoundMs));
      if (video) video.currentTime = nextTimestampMs / 1_000;
      reportTime(nextTimestampMs);
    },
    [durationMs, fallbackDurationMs, reportTime],
  );

  const jumpBySeconds = useCallback(
    (seconds: number) => {
      const video = videoRef.current;
      const baseTimestampMs = video && Number.isFinite(video.currentTime) ? video.currentTime * 1_000 : currentTimeMs;
      seekToMs(baseTimestampMs + seconds * 1_000);
    },
    [currentTimeMs, seekToMs],
  );

  const togglePlayback = useCallback(async () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused || video.ended) {
      try {
        await video.play();
      } catch (error) {
        onPlaybackError?.(error);
      }
      return;
    }
    video.pause();
  }, [onPlaybackError]);

  const setMuted = useCallback(
    (nextMuted: boolean) => {
      const effectiveMuted = audioEnabled ? nextMuted : true;
      if (videoRef.current) videoRef.current.muted = effectiveMuted;
      setMutedState(effectiveMuted);
    },
    [audioEnabled],
  );

  const toggleMuted = useCallback(() => {
    if (!audioEnabled) return;
    const video = videoRef.current;
    setMuted(video ? !video.muted : !muted);
  }, [audioEnabled, muted, setMuted]);

  const setVolume = useCallback(
    (nextVolume: number) => {
      if (!audioEnabled) return;
      const normalized = clamp(nextVolume, 0, 1);
      const video = videoRef.current;
      if (normalized > 0) lastAudibleVolumeRef.current = normalized;
      if (video) {
        video.volume = normalized;
        video.muted = normalized === 0;
      }
      setVolumeState(normalized);
      setMutedState(normalized === 0);
    },
    [audioEnabled],
  );

  const setPlaybackRate = useCallback((nextRate: number) => {
    const normalized = clamp(nextRate, 0.25, 4);
    if (videoRef.current) videoRef.current.playbackRate = normalized;
    setPlaybackRateState(normalized);
  }, []);

  useEffect(() => {
    setPlaying(false);
    setCurrentTimeMs(0);
    setDurationMs(fallbackDurationMs);
    const video = videoRef.current;
    if (audioEnabled) {
      const restoredVolume = lastAudibleVolumeRef.current;
      if (video) {
        video.volume = restoredVolume;
        video.muted = false;
      }
      setVolumeState(restoredVolume);
      setMutedState(false);
    } else {
      if (video) video.muted = true;
      setMutedState(true);
    }
    onPlaybackTimeChangeRef.current?.(0);
  }, [audioEnabled, fallbackDurationMs, sourceId]);

  useEffect(() => {
    if (!enabled) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || isTextEntryTarget(event.target)) {
        return;
      }
      if (event.code === 'Space') {
        event.preventDefault();
        void togglePlayback();
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault();
        jumpBySeconds(-10);
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        jumpBySeconds(10);
      } else if (event.key.toLocaleLowerCase() === 'm') {
        event.preventDefault();
        toggleMuted();
      } else if (event.key.toLocaleLowerCase() === 'f') {
        event.preventDefault();
        void toggleFullscreen();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [enabled, jumpBySeconds, toggleFullscreen, toggleMuted, togglePlayback]);

  function onLoadedMetadata(event: SyntheticEvent<HTMLVideoElement>) {
    const video = event.currentTarget;
    video.playbackRate = playbackRate;
    video.volume = volume > 0 ? volume : 1;
    video.muted = muted || !audioEnabled;
    syncDuration(video);
    reportTime(video.currentTime * 1_000);
  }

  function onTimeUpdate(event: SyntheticEvent<HTMLVideoElement>) {
    reportTime(event.currentTarget.currentTime * 1_000);
  }

  function onVolumeChange(event: SyntheticEvent<HTMLVideoElement>) {
    if (event.currentTarget.volume > 0) lastAudibleVolumeRef.current = event.currentTarget.volume;
    setVolumeState(event.currentTarget.volume);
    setMutedState(!audioEnabled || event.currentTarget.muted || event.currentTarget.volume === 0);
  }

  function onPlay() {
    setPlaying(true);
    onPlaybackStateChange?.(true);
  }

  function onPause() {
    setPlaying(false);
    onPlaybackStateChange?.(false);
  }

  function onMediaError(event: SyntheticEvent<HTMLVideoElement>) {
    onPlaybackError?.(event.currentTarget.error ?? event.nativeEvent);
  }

  return {
    playerRef,
    videoRef,
    state: {
      playing,
      currentTimeMs,
      durationMs,
      volume,
      muted,
      playbackRate,
      pictureInPicture: displayModes.pictureInPicture,
      fullscreen: displayModes.fullscreen,
      fallbackFullscreen: displayModes.fallbackFullscreen,
      canPictureInPicture: displayModes.canPictureInPicture,
    },
    actions: {
      seekToMs,
      jumpBySeconds,
      togglePlayback,
      setMuted,
      toggleMuted,
      setVolume,
      setPlaybackRate,
      togglePictureInPicture: displayModes.togglePictureInPicture,
      toggleFullscreen: displayModes.toggleFullscreen,
    },
    videoEvents: {
      onLoadedMetadata,
      onDurationChange: onLoadedMetadata,
      onTimeUpdate,
      onVolumeChange,
      onPlay,
      onPause,
      onEnded: onPause,
      onError: onMediaError,
    },
  };
}
