import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Download,
  Eye,
  EyeOff,
  Film,
  LoaderCircle,
  Pause,
  Play,
  RefreshCw,
  RotateCcw,
  Save,
  Scissors,
  Volume2,
  VolumeX,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  createExport,
  getProjectOverview,
  updateTimeline,
  type Dubbing,
  type ProjectOverview,
  type Storyboard,
  type Timeline,
  type TimelineClip,
  type TimelineTrack,
  type VideoItem,
} from "../../lib/api";
import { useCurrentProjectId } from "../../lib/session";
import { cn } from "../../lib/utils";

type TimelineEntry = {
  storyboard: Storyboard;
  dubbing?: Dubbing;
  latestVideo?: VideoItem;
};

function roundSeconds(value: number) {
  return Math.round(Math.max(0, value) * 100) / 100;
}

function formatSeconds(value: number) {
  const safe = Math.max(0, value);
  const minutes = Math.floor(safe / 60);
  const seconds = safe - minutes * 60;
  return `${String(minutes).padStart(2, "0")}:${seconds.toFixed(1).padStart(4, "0")}`;
}

function hasDetailedTimeline(timeline: Timeline | null | undefined) {
  return Boolean(
    timeline &&
      Array.isArray(timeline.tracks) &&
      timeline.tracks.some(
        (track) => Array.isArray((track as Partial<TimelineTrack>).clips),
      ),
  );
}

function hasPlayableVideoTimeline(timeline: Timeline | null | undefined) {
  const videoTrack =
    timeline?.tracks.find((track) => track.type === "video") ?? null;
  if (!videoTrack || !Array.isArray(videoTrack.clips)) {
    return false;
  }

  return videoTrack.clips.some(
    (clip) => clip.enabled !== false && Boolean(clip.url),
  );
}

function pickPreviewImage(entry: TimelineEntry) {
  if (entry.latestVideo?.thumbnailUrl) {
    return entry.latestVideo.thumbnailUrl;
  }

  if (entry.storyboard.imageUrl) {
    return entry.storyboard.imageUrl;
  }

  return null;
}

function buildEntries(overview: ProjectOverview): TimelineEntry[] {
  const readyVideos = [...overview.videos]
    .filter((item) => item.status === "ready" && item.videoUrl)
    .sort(
      (left, right) =>
        new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime(),
    );
  const readyVideoByStoryboardId = new Map<string, VideoItem>();
  for (const video of readyVideos) {
    if (!readyVideoByStoryboardId.has(video.storyboardId)) {
      readyVideoByStoryboardId.set(video.storyboardId, video);
    }
  }

  const dubbingByStoryboardId = new Map<string, Dubbing>();
  for (const dubbing of overview.dubbings) {
    if (
      dubbing.status === "ready" &&
      dubbing.audioUrl &&
      !dubbingByStoryboardId.has(dubbing.storyboardId)
    ) {
      dubbingByStoryboardId.set(dubbing.storyboardId, dubbing);
    }
  }

  return [...overview.storyboards]
    .sort((left, right) => left.shotNo - right.shotNo)
    .map((storyboard) => ({
      storyboard,
      dubbing: dubbingByStoryboardId.get(storyboard.id),
      latestVideo: readyVideoByStoryboardId.get(storyboard.id),
    }));
}

function normalizeTrack(track: TimelineTrack): TimelineTrack {
  return {
    ...track,
    enabled: track.enabled !== false,
    muted: track.muted === true,
    volume:
      typeof track.volume === "number" && Number.isFinite(track.volume)
        ? Math.min(1, Math.max(0, track.volume))
        : 1,
    itemCount: Array.isArray(track.clips) ? track.clips.length : 0,
    clips: Array.isArray(track.clips)
      ? track.clips.map((clip) => ({
          ...clip,
          durationSeconds: Math.max(0.5, roundSeconds(clip.durationSeconds || 0.5)),
          trimStartSeconds: roundSeconds(clip.trimStartSeconds || 0),
          startTimeSeconds: roundSeconds(clip.startTimeSeconds || 0),
          enabled: clip.enabled !== false,
          muted: clip.muted === true,
          text: clip.text || "",
        }))
      : [],
  };
}

function reflowTimeline(timeline: Timeline): Timeline {
  const normalizedTracks = timeline.tracks.map(normalizeTrack);
  const videoTrack = normalizedTracks.find((track) => track.type === "video");
  const audioTrack = normalizedTracks.find((track) => track.type === "audio");

  const previousVideoStartByStoryboardId = new Map<string, number>();
  for (const clip of videoTrack?.clips ?? []) {
    if (clip.storyboardId) {
      previousVideoStartByStoryboardId.set(clip.storyboardId, clip.startTimeSeconds);
    }
  }

  let cursor = 0;
  const nextVideoClips = (videoTrack?.clips ?? []).map((clip) => {
    const durationSeconds = Math.max(0.5, roundSeconds(clip.durationSeconds || 0.5));
    const nextClip: TimelineClip = {
      ...clip,
      durationSeconds,
      trimStartSeconds: roundSeconds(clip.trimStartSeconds || 0),
      startTimeSeconds: roundSeconds(cursor),
      enabled: clip.enabled !== false,
      muted: clip.muted === true,
    };

    if (nextClip.enabled) {
      cursor += nextClip.durationSeconds;
    }

    return nextClip;
  });

  const nextVideoStartByStoryboardId = new Map<string, number>();
  for (const clip of nextVideoClips) {
    if (clip.storyboardId) {
      nextVideoStartByStoryboardId.set(clip.storyboardId, clip.startTimeSeconds);
    }
  }

  const nextAudioClips = (audioTrack?.clips ?? []).map((clip) => {
    let startTimeSeconds = roundSeconds(clip.startTimeSeconds || 0);
    if (clip.storyboardId) {
      const previousStart = previousVideoStartByStoryboardId.get(clip.storyboardId);
      const nextStart = nextVideoStartByStoryboardId.get(clip.storyboardId);
      if (typeof previousStart === "number" && typeof nextStart === "number") {
        startTimeSeconds = roundSeconds(nextStart + (startTimeSeconds - previousStart));
      }
    }

    return {
      ...clip,
      startTimeSeconds: Math.max(0, startTimeSeconds),
      durationSeconds: Math.max(0.5, roundSeconds(clip.durationSeconds || 0.5)),
      trimStartSeconds: roundSeconds(clip.trimStartSeconds || 0),
      enabled: clip.enabled !== false,
      muted: clip.muted === true,
    };
  });

  const tracks = normalizedTracks.map((track) => {
    if (track.type === "video") {
      return {
        ...track,
        itemCount: nextVideoClips.length,
        clips: nextVideoClips,
      };
    }

    if (track.type === "audio") {
      return {
        ...track,
        itemCount: nextAudioClips.length,
        clips: nextAudioClips,
      };
    }

    return track;
  });

  const totalDurationSeconds = roundSeconds(
    tracks.reduce((maxDuration, track) => {
      if (track.enabled === false) return maxDuration;
      const trackDuration = track.clips.reduce((clipMax, clip) => {
        if (clip.enabled === false) return clipMax;
        return Math.max(clipMax, clip.startTimeSeconds + clip.durationSeconds);
      }, 0);
      return Math.max(maxDuration, trackDuration);
    }, 0),
  );

  return {
    ...timeline,
    totalDurationSeconds,
    tracks,
  };
}

function buildDefaultTimeline(
  overview: ProjectOverview,
  existingTimeline?: Timeline | null,
): Timeline {
  const entries = buildEntries(overview).filter((entry) => entry.latestVideo?.videoUrl);
  const existingVideoTrack = existingTimeline?.tracks.find((track) => track.type === "video");
  const existingAudioTrack = existingTimeline?.tracks.find((track) => track.type === "audio");
  let playhead = 0;

  const videoClips: TimelineClip[] = entries.map((entry) => {
    const existingClip =
      existingVideoTrack?.clips.find(
        (clip) =>
          clip.storyboardId === entry.storyboard.id ||
          clip.sourceId === entry.latestVideo?.id,
      ) ?? null;
    const durationSeconds = Math.max(
      0.5,
      roundSeconds(
        existingClip?.durationSeconds ||
          entry.latestVideo?.durationSeconds ||
          entry.storyboard.durationSeconds ||
          3,
      ),
    );
    const clip: TimelineClip = {
      id: existingClip?.id || `track_video_${entry.storyboard.id}`,
      type: "video",
      sourceType: "storyboard_video",
      sourceId: entry.latestVideo?.id || null,
      storyboardId: entry.storyboard.id,
      title: `S${String(entry.storyboard.shotNo).padStart(2, "0")} ${entry.storyboard.title}`,
      startTimeSeconds: roundSeconds(playhead),
      durationSeconds,
      trimStartSeconds: roundSeconds(existingClip?.trimStartSeconds || 0),
      enabled: existingClip?.enabled !== false,
      muted: existingClip?.muted === true,
      url: entry.latestVideo?.videoUrl || null,
      thumbnailUrl:
        entry.latestVideo?.thumbnailUrl || entry.storyboard.imageUrl || null,
      text: entry.storyboard.script || "",
    };

    if (clip.enabled) {
      playhead += clip.durationSeconds;
    }

    return clip;
  });

  const videoClipByStoryboardId = new Map(
    videoClips.map((clip) => [clip.storyboardId, clip]),
  );
  const audioClips: TimelineClip[] = entries
    .filter((entry) => entry.dubbing?.audioUrl)
    .map((entry) => {
      const linkedVideoClip = videoClipByStoryboardId.get(entry.storyboard.id);
      const existingClip =
        existingAudioTrack?.clips.find(
          (clip) =>
            clip.storyboardId === entry.storyboard.id ||
            clip.sourceId === entry.dubbing?.id,
        ) ?? null;
      return {
        id: existingClip?.id || `track_audio_${entry.dubbing?.id || entry.storyboard.id}`,
        type: "audio",
        sourceType: "dubbing_audio",
        sourceId: entry.dubbing?.id || null,
        storyboardId: entry.storyboard.id,
        title: entry.dubbing?.speakerName || entry.storyboard.title,
        startTimeSeconds: roundSeconds(
          existingClip?.startTimeSeconds ?? linkedVideoClip?.startTimeSeconds ?? 0,
        ),
        durationSeconds: Math.max(
          0.5,
          roundSeconds(existingClip?.durationSeconds || linkedVideoClip?.durationSeconds || 3),
        ),
        trimStartSeconds: roundSeconds(existingClip?.trimStartSeconds || 0),
        enabled: existingClip?.enabled !== false,
        muted: existingClip?.muted === true,
        url: entry.dubbing?.audioUrl || null,
        thumbnailUrl: linkedVideoClip?.thumbnailUrl || null,
        text: entry.dubbing?.text || entry.storyboard.script || "",
      };
    });

  return reflowTimeline({
    projectId: overview.project.id,
    version: existingTimeline?.version || overview.timeline.version || 1,
    totalDurationSeconds: 0,
    updatedAt: existingTimeline?.updatedAt || overview.timeline.updatedAt,
    tracks: [
      {
        id: "track_video",
        type: "video",
        label: "视频轨",
        enabled: existingVideoTrack?.enabled !== false,
        muted: existingVideoTrack?.muted === true,
        volume: existingVideoTrack?.volume ?? 1,
        itemCount: videoClips.length,
        clips: videoClips,
      },
      {
        id: "track_audio",
        type: "audio",
        label: "配音轨",
        enabled: existingAudioTrack?.enabled !== false,
        muted: existingAudioTrack?.muted === true,
        volume: existingAudioTrack?.volume ?? 1,
        itemCount: audioClips.length,
        clips: audioClips,
      },
    ],
  });
}

function findTrack(timeline: Timeline | null, type: "video" | "audio") {
  return timeline?.tracks.find((track) => track.type === type) ?? null;
}

function findClipAtTime(track: TimelineTrack | null, playheadSeconds: number) {
  if (!track || track.enabled === false) return null;
  return (
    [...track.clips]
      .sort((left, right) => left.startTimeSeconds - right.startTimeSeconds)
      .find((clip) => {
        if (clip.enabled === false) return false;
        return (
          playheadSeconds >= clip.startTimeSeconds &&
          playheadSeconds < clip.startTimeSeconds + clip.durationSeconds
        );
      }) || null
  );
}

function syncMediaElement(
  element: HTMLMediaElement | null,
  clip: TimelineClip | null,
  playheadSeconds: number,
  shouldPlay: boolean,
  muted: boolean,
  volume = 1,
) {
  if (!element) return;

  if (!clip?.url || clip.enabled === false) {
    element.pause();
    if (element.getAttribute("data-src")) {
      element.removeAttribute("src");
      element.removeAttribute("data-src");
      element.load();
    }
    return;
  }

  const desiredSource = clip.url;
  const desiredTime = Math.max(
    0,
    clip.trimStartSeconds + (playheadSeconds - clip.startTimeSeconds),
  );
  const syncTime = () => {
    const mediaDuration = Number.isFinite(element.duration) ? element.duration : null;
    const clampedTime =
      typeof mediaDuration === "number" && mediaDuration > 0
        ? Math.min(desiredTime, Math.max(0, mediaDuration - 0.05))
        : desiredTime;
    if (Math.abs(element.currentTime - clampedTime) > 0.35) {
      element.currentTime = clampedTime;
    }
    element.muted = muted;
    element.volume = Math.min(1, Math.max(0, volume));
    if (shouldPlay) {
      void element.play().catch(() => {});
    } else {
      element.pause();
    }
  };

  if (element.getAttribute("data-src") !== desiredSource) {
    element.pause();
    element.setAttribute("data-src", desiredSource);
    element.src = desiredSource;
    element.load();
    element.onloadedmetadata = () => {
      syncTime();
    };
    return;
  }

  syncTime();
}

export default function Preview() {
  const [currentProjectId] = useCurrentProjectId();
  const [overview, setOverview] = useState<ProjectOverview | null>(null);
  const [timeline, setTimeline] = useState<Timeline | null>(null);
  const [loading, setLoading] = useState(true);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [timelineDirty, setTimelineDirty] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportFormat, setExportFormat] = useState("mp4");
  const [selectedTrackId, setSelectedTrackId] = useState<string>("");
  const [selectedClipId, setSelectedClipId] = useState<string>("");
  const [playheadSeconds, setPlayheadSeconds] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const timelineRef = useRef<Timeline | null>(null);

  const loadData = async () => {
    setLoading(true);
    setErrorMessage(null);
    try {
      const overviewResponse = await getProjectOverview(currentProjectId);
      const timelineHasStructure = hasDetailedTimeline(overviewResponse.timeline);
      const timelineHasPlayableVideo = hasPlayableVideoTimeline(
        overviewResponse.timeline,
      );
      const hasGeneratedVideos = overviewResponse.videos.some(
        (video) => video.status === "ready" && Boolean(video.videoUrl),
      );
      const shouldRebuildDefaultTimeline =
        !timelineHasStructure || (hasGeneratedVideos && !timelineHasPlayableVideo);
      const nextTimeline = shouldRebuildDefaultTimeline
        ? buildDefaultTimeline(overviewResponse, overviewResponse.timeline)
        : reflowTimeline(overviewResponse.timeline);
      setOverview({
        ...overviewResponse,
        timeline: nextTimeline,
      });
      setTimeline(nextTimeline);
      timelineRef.current = nextTimeline;

      if (shouldRebuildDefaultTimeline) {
        setSaveState("saving");
        const savedTimeline = await updateTimeline(currentProjectId, {
          tracks: nextTimeline.tracks,
          totalDurationSeconds: nextTimeline.totalDurationSeconds,
        });
        setTimeline(savedTimeline);
        timelineRef.current = savedTimeline;
        setOverview((currentOverview) =>
          currentOverview
            ? {
                ...currentOverview,
                timeline: savedTimeline,
              }
            : currentOverview,
        );
        setSaveState("saved");
      } else {
        setSaveState("idle");
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "节点七数据加载失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, [currentProjectId]);

  useEffect(() => {
    timelineRef.current = timeline;
  }, [timeline]);

  const entries = useMemo(() => (overview ? buildEntries(overview) : []), [overview]);
  const videoTrack = useMemo(() => findTrack(timeline, "video"), [timeline]);
  const audioTrack = useMemo(() => findTrack(timeline, "audio"), [timeline]);
  const allClips = useMemo(
    () => timeline?.tracks.flatMap((track) => track.clips) ?? [],
    [timeline],
  );
  const selectedTrack =
    timeline?.tracks.find((track) => track.id === selectedTrackId) ??
    videoTrack ??
    audioTrack ??
    null;
  const selectedClip =
    selectedTrack?.clips.find((clip) => clip.id === selectedClipId) ??
    allClips.find((clip) => clip.id === selectedClipId) ??
    videoTrack?.clips[0] ??
    audioTrack?.clips[0] ??
    null;
  const activeVideoClip = useMemo(
    () =>
      findClipAtTime(videoTrack, playheadSeconds) ??
      videoTrack?.clips.find((clip) => clip.enabled !== false) ??
      null,
    [videoTrack, playheadSeconds],
  );
  const activeAudioClip = useMemo(
    () => findClipAtTime(audioTrack, playheadSeconds),
    [audioTrack, playheadSeconds],
  );
  const activeEntry =
    entries.find((entry) => entry.storyboard.id === activeVideoClip?.storyboardId) ?? null;
  const latestTask = overview?.tasks[0] ?? null;
  const exportTask = overview?.tasks.find((task) => task.type === "project_export") ?? null;

  useEffect(() => {
    if (!selectedClipId) {
      if (videoTrack?.clips[0]) {
        setSelectedTrackId(videoTrack.id);
        setSelectedClipId(videoTrack.clips[0].id);
      } else if (audioTrack?.clips[0]) {
        setSelectedTrackId(audioTrack.id);
        setSelectedClipId(audioTrack.clips[0].id);
      }
      return;
    }

    const clipStillExists = allClips.some((clip) => clip.id === selectedClipId);
    if (!clipStillExists) {
      if (videoTrack?.clips[0]) {
        setSelectedTrackId(videoTrack.id);
        setSelectedClipId(videoTrack.clips[0].id);
      } else if (audioTrack?.clips[0]) {
        setSelectedTrackId(audioTrack.id);
        setSelectedClipId(audioTrack.clips[0].id);
      } else {
        setSelectedClipId("");
        setSelectedTrackId("");
      }
    }
  }, [allClips, audioTrack, selectedClipId, videoTrack]);

  useEffect(() => {
    if (!timeline) return;
    if (playheadSeconds <= timeline.totalDurationSeconds) return;
    setPlayheadSeconds(timeline.totalDurationSeconds);
  }, [playheadSeconds, timeline]);

  useEffect(() => {
    if (!timeline || !isPlaying) return;
    const timer = window.setInterval(() => {
      setPlayheadSeconds((current) => {
        const next = roundSeconds(current + 0.1);
        if (next >= timeline.totalDurationSeconds) {
          window.clearInterval(timer);
          setIsPlaying(false);
          return timeline.totalDurationSeconds;
        }
        return next;
      });
    }, 100);

    return () => {
      window.clearInterval(timer);
    };
  }, [isPlaying, timeline]);

  useEffect(() => {
    syncMediaElement(
      videoRef.current,
      activeVideoClip,
      playheadSeconds,
      isPlaying,
      videoTrack?.muted === true || activeVideoClip?.muted === true,
      videoTrack?.volume ?? 1,
    );
  }, [activeVideoClip, isPlaying, playheadSeconds, videoTrack]);

  useEffect(() => {
    syncMediaElement(
      audioRef.current,
      activeAudioClip,
      playheadSeconds,
      isPlaying,
      audioTrack?.muted === true || activeAudioClip?.muted === true,
      audioTrack?.volume ?? 1,
    );
  }, [activeAudioClip, audioTrack, isPlaying, playheadSeconds]);

  const applyTimeline = (updater: (current: Timeline) => Timeline) => {
    setTimeline((currentTimeline) => {
      if (!currentTimeline) return currentTimeline;
      const nextTimeline = reflowTimeline(updater(currentTimeline));
      timelineRef.current = nextTimeline;
      setTimelineDirty(true);
      setSaveState("idle");
      return nextTimeline;
    });
  };

  const persistTimeline = async (targetTimeline?: Timeline | null) => {
    const currentTimeline = targetTimeline ?? timelineRef.current;
    if (!currentTimeline) return null;
    setSaveState("saving");
    try {
      const savedTimeline = await updateTimeline(currentProjectId, {
        tracks: currentTimeline.tracks,
        totalDurationSeconds: currentTimeline.totalDurationSeconds,
      });
      setTimeline(savedTimeline);
      timelineRef.current = savedTimeline;
      setOverview((currentOverview) =>
        currentOverview
          ? {
              ...currentOverview,
              timeline: savedTimeline,
            }
          : currentOverview,
      );
      setTimelineDirty(false);
      setSaveState("saved");
      return savedTimeline;
    } catch (error) {
      setSaveState("error");
      setErrorMessage(error instanceof Error ? error.message : "时间线保存失败");
      return null;
    }
  };

  const handleSelectClip = (trackId: string, clipId: string, startTimeSeconds: number) => {
    setSelectedTrackId(trackId);
    setSelectedClipId(clipId);
    setPlayheadSeconds(startTimeSeconds);
  };

  const handleMoveVideoClip = (direction: "left" | "right") => {
    if (!videoTrack || !selectedClip) return;
    const currentIndex = videoTrack.clips.findIndex((clip) => clip.id === selectedClip.id);
    const targetIndex = direction === "left" ? currentIndex - 1 : currentIndex + 1;
    if (currentIndex < 0 || targetIndex < 0 || targetIndex >= videoTrack.clips.length) {
      return;
    }

    applyTimeline((currentTimeline) => {
      const nextTracks = currentTimeline.tracks.map((track) => {
        if (track.type !== "video") return track;
        const clips = [...track.clips];
        const [movedClip] = clips.splice(currentIndex, 1);
        clips.splice(targetIndex, 0, movedClip);
        return {
          ...track,
          clips,
        };
      });

      return {
        ...currentTimeline,
        tracks: nextTracks,
      };
    });
  };

  const handleTrackToggle = (trackId: string, field: "enabled" | "muted") => {
    applyTimeline((currentTimeline) => ({
      ...currentTimeline,
      tracks: currentTimeline.tracks.map((track) =>
        track.id === trackId
          ? {
              ...track,
              [field]: !(track as Record<string, unknown>)[field],
            }
          : track,
      ),
    }));
  };

  const handleTrackVolumeChange = (trackId: string, nextValue: number) => {
    applyTimeline((currentTimeline) => ({
      ...currentTimeline,
      tracks: currentTimeline.tracks.map((track) =>
        track.id === trackId
          ? {
              ...track,
              volume: Math.min(1, Math.max(0, nextValue)),
            }
          : track,
      ),
    }));
  };

  const handleClipChange = (
    trackId: string,
    clipId: string,
    patch: Partial<TimelineClip>,
  ) => {
    applyTimeline((currentTimeline) => ({
      ...currentTimeline,
      tracks: currentTimeline.tracks.map((track) =>
        track.id === trackId
          ? {
              ...track,
              clips: track.clips.map((clip) =>
                clip.id === clipId
                  ? {
                      ...clip,
                      ...patch,
                    }
                  : clip,
              ),
            }
          : track,
      ),
    }));
  };

  const handleRestoreDefault = () => {
    if (!overview) return;
    const nextTimeline = buildDefaultTimeline(overview, timeline);
    setTimeline(nextTimeline);
    timelineRef.current = nextTimeline;
    setTimelineDirty(true);
    setSaveState("idle");
    setPlayheadSeconds(0);
  };

  const handleExport = async () => {
    if (!timeline) return;
    setExporting(true);
    try {
      if (timelineDirty) {
        const savedTimeline = await persistTimeline(timeline);
        if (!savedTimeline) return;
      }

      await createExport(currentProjectId, exportFormat);
      window.setTimeout(() => {
        void loadData();
      }, 1500);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "成片导出失败");
    } finally {
      window.setTimeout(() => setExporting(false), 1200);
    }
  };

  const selectedStoryboard =
    entries.find((entry) => entry.storyboard.id === selectedClip?.storyboardId)?.storyboard ??
    null;
  const selectedDubbing =
    entries.find((entry) => entry.storyboard.id === selectedClip?.storyboardId)?.dubbing ??
    null;

  return (
    <div className="flex h-full w-full flex-col">
      <div className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-card/30 px-6">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
            <CheckCircle2 className="h-3.5 w-3.5" />
            {saveState === "saving"
              ? "时间线保存中"
              : timeline
                ? `时间线 v${timeline.version}`
                : "时间线未就绪"}
          </div>
          <div className="text-xs text-muted-foreground">
            默认使用节点五已生成的分镜视频顺序拼接，可在下方继续剪辑音视频轨。
          </div>
          {loading ? <LoaderCircle className="h-4 w-4 animate-spin text-primary" /> : null}
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => void loadData()}
            className="flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-sm font-medium transition-colors hover:bg-accent"
          >
            <RefreshCw className="h-4 w-4" />
            刷新
          </button>
          <button
            onClick={() => handleRestoreDefault()}
            disabled={!overview}
            className="flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-sm font-medium transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
          >
            <RotateCcw className="h-4 w-4" />
            恢复默认编排
          </button>
          <button
            onClick={() => void persistTimeline(timeline)}
            disabled={!timeline || saveState === "saving"}
            className="flex items-center gap-2 rounded-md border border-primary/30 bg-primary/10 px-3 py-1.5 text-sm font-medium text-primary transition-colors hover:bg-primary/15 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {saveState === "saving" ? (
              <LoaderCircle className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            保存时间线
          </button>
          <button
            onClick={() => void handleExport()}
            disabled={exporting || !overview}
            className="flex items-center gap-2 rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-70"
          >
            {exporting ? (
              <LoaderCircle className="h-4 w-4 animate-spin" />
            ) : (
              <Download className="h-4 w-4" />
            )}
            导出成片
          </button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        <section className="flex min-w-0 flex-1 flex-col border-r border-border bg-black/40">
          <div className="flex flex-1 flex-col overflow-hidden p-6">
            <div className="relative aspect-video w-full overflow-hidden rounded-2xl border border-border bg-black shadow-2xl">
              {activeVideoClip?.url ? (
                <>
                  <video
                    ref={videoRef}
                    className="h-full w-full object-cover"
                    playsInline
                    preload="auto"
                  />
                  <audio ref={audioRef} className="hidden" preload="auto" />
                  <div className="absolute left-4 top-4 rounded-full bg-black/65 px-3 py-1 text-xs text-white backdrop-blur">
                    {activeVideoClip.title}
                  </div>
                  <div className="absolute right-4 top-4 rounded-full bg-black/65 px-3 py-1 text-xs text-white backdrop-blur">
                    {formatSeconds(playheadSeconds)} / {formatSeconds(timeline?.totalDurationSeconds ?? 0)}
                  </div>
                  <div className="absolute bottom-6 left-6 right-6">
                    <div className="rounded-2xl bg-black/55 px-4 py-3 text-center text-sm text-white backdrop-blur">
                      {activeAudioClip?.text || activeVideoClip.text || "当前镜头未设置字幕文本"}
                    </div>
                  </div>
                </>
              ) : (
                <div className="flex h-full flex-col items-center justify-center gap-3 text-center text-muted-foreground">
                  <Film className="h-10 w-10" />
                  <div>
                    <p className="text-base font-medium text-foreground">
                      还没有可预览的时间线视频
                    </p>
                    <p className="mt-1 text-sm">
                      先在节点五为镜头生成视频，节点七会默认把已生成镜头按顺序拼接进来。
                    </p>
                  </div>
                </div>
              )}
            </div>

            <div className="mt-4 rounded-2xl border border-border bg-card/40 p-4">
              <div className="flex flex-wrap items-center gap-3">
                <button
                  onClick={() => setIsPlaying((current) => !current)}
                  disabled={!timeline?.totalDurationSeconds}
                  className="flex h-11 w-11 items-center justify-center rounded-full bg-primary text-primary-foreground transition-transform hover:scale-105 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isPlaying ? <Pause className="h-5 w-5" /> : <Play className="ml-0.5 h-5 w-5" />}
                </button>
                <input
                  type="range"
                  min={0}
                  max={timeline?.totalDurationSeconds ?? 0}
                  step={0.1}
                  value={playheadSeconds}
                  onChange={(event) => {
                    setPlayheadSeconds(Number(event.target.value));
                  }}
                  className="min-w-[220px] flex-1 accent-primary"
                />
                <div className="text-sm font-medium">
                  {formatSeconds(playheadSeconds)} / {formatSeconds(timeline?.totalDurationSeconds ?? 0)}
                </div>
                {timelineDirty ? (
                  <span className="rounded-full bg-amber-500/15 px-3 py-1 text-xs font-medium text-amber-300">
                    有未保存编辑
                  </span>
                ) : null}
                {activeAudioClip?.url ? (
                  <a
                    href={activeAudioClip.url}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent"
                  >
                    当前配音试听
                  </a>
                ) : null}
                {activeVideoClip?.url ? (
                  <a
                    href={activeVideoClip.url}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent"
                  >
                    打开当前视频
                  </a>
                ) : null}
              </div>
            </div>

            <div className="mt-5 flex-1 overflow-y-auto rounded-2xl border border-border bg-card/35 p-5 custom-scrollbar">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-foreground">时间线轨道</h3>
                  <p className="mt-1 text-xs text-muted-foreground">
                    点击片段可在右侧编辑，视频轨支持重排，配音轨支持错位和静音。
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <label className="text-xs text-muted-foreground">导出格式</label>
                  <select
                    value={exportFormat}
                    onChange={(event) => setExportFormat(event.target.value)}
                    className="rounded-md border border-border bg-input px-3 py-1.5 text-xs"
                  >
                    <option value="mp4">MP4</option>
                    <option value="mov">MOV</option>
                  </select>
                </div>
              </div>

              <div className="space-y-5">
                {(timeline?.tracks ?? []).map((track) => {
                  const sortedClips = [...track.clips].sort(
                    (left, right) => left.startTimeSeconds - right.startTimeSeconds,
                  );
                  const totalDuration = Math.max(timeline?.totalDurationSeconds ?? 0, 1);

                  return (
                    <div key={track.id} className="rounded-2xl border border-border/80 bg-background/55 p-4">
                      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                        <div className="flex items-center gap-3">
                          <div className="rounded-full bg-secondary px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                            {track.label}
                          </div>
                          <span className="text-xs text-muted-foreground">
                            {track.itemCount} 个片段
                          </span>
                        </div>

                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => handleTrackToggle(track.id, "enabled")}
                            className="flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium transition-colors hover:bg-accent"
                          >
                            {track.enabled === false ? (
                              <>
                                <EyeOff className="h-3.5 w-3.5" />
                                轨道关闭
                              </>
                            ) : (
                              <>
                                <Eye className="h-3.5 w-3.5" />
                                轨道启用
                              </>
                            )}
                          </button>
                          <button
                            onClick={() => handleTrackToggle(track.id, "muted")}
                            className="flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium transition-colors hover:bg-accent"
                          >
                            {track.muted === true ? (
                              <>
                                <VolumeX className="h-3.5 w-3.5" />
                                已静音
                              </>
                            ) : (
                              <>
                                <Volume2 className="h-3.5 w-3.5" />
                                有声音
                              </>
                            )}
                          </button>
                          <input
                            type="range"
                            min={0}
                            max={1}
                            step={0.05}
                            value={track.volume ?? 1}
                            onChange={(event) =>
                              handleTrackVolumeChange(track.id, Number(event.target.value))
                            }
                            className="w-24 accent-primary"
                          />
                        </div>
                      </div>

                      <div className="relative h-24 overflow-hidden rounded-xl border border-border bg-secondary/20">
                        {sortedClips.length ? (
                          sortedClips.map((clip) => {
                            const left = `${(clip.startTimeSeconds / totalDuration) * 100}%`;
                            const width = `${Math.max((clip.durationSeconds / totalDuration) * 100, 8)}%`;
                            const previewImage =
                              clip.thumbnailUrl ||
                              entries.find((entry) => entry.storyboard.id === clip.storyboardId)
                                ?.storyboard.imageUrl ||
                              "";

                            return (
                              <button
                                key={clip.id}
                                onClick={() =>
                                  handleSelectClip(track.id, clip.id, clip.startTimeSeconds)
                                }
                                style={{ left, width }}
                                className={cn(
                                  "absolute top-2 h-20 min-w-[88px] overflow-hidden rounded-xl border text-left transition-transform hover:-translate-y-0.5",
                                  clip.type === "video"
                                    ? "border-sky-400/40 bg-sky-500/15"
                                    : "border-indigo-400/40 bg-indigo-500/15",
                                  clip.enabled === false && "opacity-40",
                                  selectedClip?.id === clip.id && "ring-2 ring-primary",
                                )}
                              >
                                {previewImage ? (
                                  <img
                                    src={previewImage}
                                    alt={clip.title}
                                    className="absolute inset-0 h-full w-full object-cover opacity-20"
                                    loading="lazy"
                                    decoding="async"
                                    referrerPolicy="no-referrer"
                                  />
                                ) : null}
                                <div className="relative flex h-full flex-col justify-between p-2.5">
                                  <div className="text-[11px] font-semibold text-foreground">
                                    {clip.title}
                                  </div>
                                  <div className="space-y-1 text-[10px] text-muted-foreground">
                                    <p>
                                      {formatSeconds(clip.startTimeSeconds)} -{" "}
                                      {formatSeconds(clip.startTimeSeconds + clip.durationSeconds)}
                                    </p>
                                    <p>{clip.durationSeconds.toFixed(1)}s</p>
                                  </div>
                                </div>
                              </button>
                            );
                          })
                        ) : (
                          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                            该轨道还没有片段
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </section>

        <aside className="flex w-[360px] shrink-0 flex-col bg-card/30">
          <div className="border-b border-border p-5">
            <h3 className="text-sm font-semibold text-foreground">剪辑检查器</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              这里可以调整当前片段的启用状态、裁剪时长和音轨对位。
            </p>
          </div>

          <div className="flex-1 space-y-5 overflow-y-auto p-5 custom-scrollbar">
            <div className="rounded-2xl border border-border bg-secondary/25 p-4 text-sm">
              <p className="font-medium text-foreground">{overview?.project.title ?? "--"}</p>
              <p className="mt-2 text-muted-foreground">
                已接入视频：{videoTrack?.clips.length ?? 0} 条
              </p>
              <p className="mt-2 text-muted-foreground">
                已接入配音：{audioTrack?.clips.length ?? 0} 条
              </p>
              <p className="mt-2 text-muted-foreground">
                画幅比例：{overview?.settings.aspectRatio ?? "--"}
              </p>
            </div>

            {selectedClip ? (
              <div className="space-y-4 rounded-2xl border border-border bg-background/55 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                      {selectedClip.type === "video" ? "Video Clip" : "Audio Clip"}
                    </p>
                    <h4 className="mt-1 text-base font-semibold text-foreground">
                      {selectedClip.title}
                    </h4>
                  </div>
                  <button
                    onClick={() =>
                      handleClipChange(selectedTrack?.id || "", selectedClip.id, {
                        enabled: selectedClip.enabled === false,
                      })
                    }
                    className="rounded-md border border-border px-2.5 py-1.5 text-xs font-medium transition-colors hover:bg-accent"
                  >
                    {selectedClip.enabled === false ? "启用片段" : "停用片段"}
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <label className="space-y-1 text-xs text-muted-foreground">
                    开始时间
                    <input
                      type="number"
                      min={0}
                      step={0.1}
                      value={selectedClip.startTimeSeconds}
                      onChange={(event) =>
                        handleClipChange(selectedTrack?.id || "", selectedClip.id, {
                          startTimeSeconds: Number(event.target.value),
                        })
                      }
                      disabled={selectedClip.type === "video"}
                      className="w-full rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground disabled:opacity-60"
                    />
                  </label>
                  <label className="space-y-1 text-xs text-muted-foreground">
                    片段时长
                    <input
                      type="number"
                      min={0.5}
                      step={0.1}
                      value={selectedClip.durationSeconds}
                      onChange={(event) =>
                        handleClipChange(selectedTrack?.id || "", selectedClip.id, {
                          durationSeconds: Number(event.target.value),
                        })
                      }
                      className="w-full rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground"
                    />
                  </label>
                </div>

                <label className="space-y-1 text-xs text-muted-foreground">
                  裁剪起点
                  <input
                    type="number"
                    min={0}
                    step={0.1}
                    value={selectedClip.trimStartSeconds}
                    onChange={(event) =>
                      handleClipChange(selectedTrack?.id || "", selectedClip.id, {
                        trimStartSeconds: Number(event.target.value),
                      })
                    }
                    className="w-full rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground"
                  />
                </label>

                {selectedClip.type === "video" ? (
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      onClick={() => handleMoveVideoClip("left")}
                      className="flex items-center justify-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-medium transition-colors hover:bg-accent"
                    >
                      <ArrowLeft className="h-4 w-4" />
                      前移
                    </button>
                    <button
                      onClick={() => handleMoveVideoClip("right")}
                      className="flex items-center justify-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-medium transition-colors hover:bg-accent"
                    >
                      后移
                      <ArrowRight className="h-4 w-4" />
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() =>
                      handleClipChange(selectedTrack?.id || "", selectedClip.id, {
                        muted: selectedClip.muted !== true,
                      })
                    }
                    className="flex w-full items-center justify-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-medium transition-colors hover:bg-accent"
                  >
                    {selectedClip.muted === true ? (
                      <>
                        <Volume2 className="h-4 w-4" />
                        取消静音
                      </>
                    ) : (
                      <>
                        <VolumeX className="h-4 w-4" />
                        静音该配音片段
                      </>
                    )}
                  </button>
                )}

                <div className="rounded-xl border border-border bg-secondary/25 p-3 text-xs text-muted-foreground">
                  <p className="font-medium text-foreground">关联镜头</p>
                  <p className="mt-2">{selectedStoryboard?.title ?? "未关联镜头"}</p>
                  <p className="mt-2 line-clamp-3">
                    {selectedDubbing?.text || selectedStoryboard?.script || "暂无文本"}
                  </p>
                </div>

                {selectedClip.type === "audio" && selectedClip.url ? (
                  <audio
                    key={selectedClip.url}
                    controls
                    src={selectedClip.url}
                    className="w-full"
                  />
                ) : null}

                {selectedClip.url ? (
                  <a
                    href={selectedClip.url}
                    target="_blank"
                    rel="noreferrer"
                    className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
                  >
                    <Scissors className="h-4 w-4" />
                    打开当前源文件
                  </a>
                ) : null}
              </div>
            ) : (
              <div className="rounded-2xl border border-border bg-background/55 p-4 text-sm text-muted-foreground">
                先在下方时间线中选择一个视频或配音片段。
              </div>
            )}

            <div className="rounded-2xl border border-border bg-secondary/25 p-4 text-sm text-muted-foreground">
              <p className="font-medium text-foreground">最近任务</p>
              {latestTask ? (
                <>
                  <p className="mt-2">{latestTask.inputSummary || latestTask.type}</p>
                  <p className="mt-2">状态：{latestTask.status}</p>
                  <p className="mt-2">阶段：{latestTask.currentStage}</p>
                  <p className="mt-2">进度：{latestTask.progressPercent}%</p>
                </>
              ) : (
                <p className="mt-2">当前没有任务记录</p>
              )}
              {exportTask ? (
                <p className="mt-3 rounded-lg bg-primary/10 px-3 py-2 text-primary">
                  最近一次导出状态：{exportTask.status}
                </p>
              ) : null}
            </div>

            {errorMessage ? (
              <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-200">
                {errorMessage}
              </div>
            ) : null}
          </div>
        </aside>
      </div>
    </div>
  );
}
