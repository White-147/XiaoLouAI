import { useState } from "react";

type ScriptBreakdownLightboxState = {
  url: string;
  label: string;
};

export function useScriptBreakdownLightbox() {
  const [lightbox, setLightbox] = useState<ScriptBreakdownLightboxState | null>(null);

  return {
    lightbox,
    openLightbox: (url: string, label: string) => setLightbox({ url, label }),
    closeLightbox: () => setLightbox(null),
  };
}
