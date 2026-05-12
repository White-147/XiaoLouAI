import { X } from "lucide-react";
import { useEffect } from "react";

type ScriptBreakdownLightboxProps = {
  label: string;
  url: string;
  onClose: () => void;
};

export function ScriptBreakdownLightbox({
  label,
  url,
  onClose,
}: ScriptBreakdownLightboxProps) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-sm"
      onClick={onClose}
    >
      <div className="absolute left-5 top-5 rounded-lg bg-background/70 px-3 py-1.5 font-mono text-sm font-medium text-foreground backdrop-blur">
        {label}
      </div>
      <button
        type="button"
        onClick={onClose}
        className="absolute right-5 top-5 flex h-9 w-9 items-center justify-center rounded-full bg-background/70 text-foreground backdrop-blur transition-colors hover:bg-background/90"
      >
        <X className="h-4 w-4" />
      </button>
      <img
        src={url}
        alt={label}
        referrerPolicy="no-referrer"
        onClick={(event) => event.stopPropagation()}
        className="max-h-[88vh] max-w-[90vw] rounded-2xl object-contain shadow-2xl shadow-black/60 ring-1 ring-white/10"
      />
    </div>
  );
}
