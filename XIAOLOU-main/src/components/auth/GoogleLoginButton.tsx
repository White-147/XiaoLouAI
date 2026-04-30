import { Chrome, LoaderCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { getAuthProviders } from "../../lib/api";
import { startGoogleLogin } from "../../lib/google-auth";
import { cn } from "../../lib/utils";

type GoogleLoginButtonProps = {
  returnTo?: string;
  label?: string;
  className?: string;
};

export function GoogleLoginButton({
  returnTo,
  label = "使用 Google 登录",
  className,
}: GoogleLoginButtonProps) {
  const [configured, setConfigured] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    void getAuthProviders()
      .then((providers) => {
        if (active) setConfigured(Boolean(providers.google?.configured));
      })
      .catch(() => {
        if (active) setConfigured(false);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  const disabled = loading || !configured;

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => startGoogleLogin(returnTo)}
      title={configured ? label : "Google 登录未配置"}
      className={cn(
        "flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-border/70 bg-background/70 px-4 py-2 text-sm font-medium text-foreground transition hover:bg-secondary/70 disabled:cursor-not-allowed disabled:opacity-55",
        className,
      )}
    >
      {loading ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Chrome className="h-4 w-4" />}
      {configured ? label : "Google 登录未配置"}
    </button>
  );
}
