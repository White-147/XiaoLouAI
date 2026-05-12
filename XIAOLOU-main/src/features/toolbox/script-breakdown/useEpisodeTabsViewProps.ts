import {
  type Dispatch,
  type SetStateAction,
  useEffect,
} from "react";
import type { EpisodeTabsBarProps } from "./EpisodeTabsBar";

export type EpisodeTabsViewProps = Omit<EpisodeTabsBarProps, "content">;

type UseEpisodeTabsViewPropsArgs = Omit<
  EpisodeTabsViewProps,
  "onToggleEpisodeSettings" | "onApplyEpisodeSettings"
> & {
  setEpisodeSettingsOpen: Dispatch<SetStateAction<boolean>>;
  applyEpisodeSettingsToCurrentEpisodes: () => boolean;
  commitEpisodeAddSettings: () => unknown;
};

export function useEpisodeTabsViewProps({
  episodeSettingsRef,
  episodeSettingsOpen,
  episodeSettingsMode,
  setEpisodeSettingsOpen,
  applyEpisodeSettingsToCurrentEpisodes,
  commitEpisodeAddSettings,
  ...episodeTabs
}: UseEpisodeTabsViewPropsArgs): EpisodeTabsViewProps {
  useEffect(() => {
    if (!episodeSettingsOpen) return;
    const close = (event: MouseEvent) => {
      if (!episodeSettingsRef.current?.contains(event.target as Node)) {
        setEpisodeSettingsOpen(false);
      }
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [episodeSettingsOpen, episodeSettingsRef, setEpisodeSettingsOpen]);

  return {
    ...episodeTabs,
    episodeSettingsRef,
    episodeSettingsOpen,
    episodeSettingsMode,
    onToggleEpisodeSettings: () => setEpisodeSettingsOpen((open) => !open),
    onApplyEpisodeSettings: () => {
      if (episodeSettingsMode === "current") {
        if (!applyEpisodeSettingsToCurrentEpisodes()) return;
      } else {
        commitEpisodeAddSettings();
      }
      setEpisodeSettingsOpen(false);
    },
  };
}
