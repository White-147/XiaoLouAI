import { ArrowLeft, LoaderCircle, LogIn, ShieldCheck } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { getMe, loginAdminWithEmail } from "../lib/api";
import { rememberKnownActor, setAuthToken, setCurrentActorId } from "../lib/actor-session";
import { GoogleLoginButton } from "../components/auth/GoogleLoginButton";

type LocationState = {
  from?: string;
};

export default function AdminLogin() {
  const navigate = useNavigate();
  const location = useLocation();
  const state = location.state as LocationState | null;
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void getMe()
      .then((me) => {
        if (!active) return;
        if (me.platformRole === "super_admin") {
          navigate(state?.from || "/admin/orders", { replace: true });
        }
      })
      .catch(() => {})
      .finally(() => {
        if (active) setChecking(false);
      });
    return () => {
      active = false;
    };
  }, [navigate, state?.from]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const result = await loginAdminWithEmail({ email, password });
      setAuthToken(result.token);
      rememberKnownActor({
        id: result.actorId,
        label: result.displayName,
        detail: result.email,
        token: result.token,
      });
      setCurrentActorId(result.actorId);
      navigate(state?.from || "/admin/orders", { replace: true });
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "登录失败，请稍后重试。");
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto px-6 py-8 custom-scrollbar sm:px-8">
      <div className="mx-auto flex min-h-full max-w-5xl items-center">
        <div className="grid w-full gap-6 lg:grid-cols-[minmax(0,0.95fr)_420px]">
          <div className="flex flex-col justify-center">
            <button
              type="button"
              onClick={() => navigate("/home")}
              className="mb-8 flex h-10 w-10 items-center justify-center rounded-xl border border-border/70 bg-background/50 text-muted-foreground transition hover:text-foreground"
              aria-label="返回首页"
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/12 text-primary">
              <ShieldCheck className="h-7 w-7" />
            </div>
            <h1 className="mt-6 text-3xl font-semibold tracking-tight text-foreground">超级管理员登录</h1>
            <p className="mt-3 max-w-xl text-sm leading-7 text-muted-foreground">
              使用正式管理员账号进入公网后台。演示超管仍只允许在本机使用。
            </p>
          </div>

          <form
            onSubmit={(event) => void handleSubmit(event)}
            className="rounded-3xl border border-border/70 bg-card/70 p-6 shadow-xl shadow-black/5 backdrop-blur"
          >
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/12 text-primary">
                <LogIn className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-base font-semibold text-foreground">后台入口</h2>
                <p className="text-xs text-muted-foreground">仅限 super_admin 账号</p>
              </div>
            </div>

            <div className="mt-6 space-y-3">
              <GoogleLoginButton
                returnTo={state?.from || "/admin/orders"}
                label="使用 Google 登录后台"
              />
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <span className="h-px flex-1 bg-border" />
                <span>或使用管理员邮箱</span>
                <span className="h-px flex-1 bg-border" />
              </div>
            </div>

            <label className="mt-4 block">
              <span className="mb-2 block text-xs font-medium text-muted-foreground">邮箱</span>
              <input
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                type="email"
                autoComplete="username"
                className="h-11 w-full rounded-2xl border border-border/70 bg-background/55 px-4 text-sm text-foreground outline-none transition focus:border-primary/50 focus:ring-1 focus:ring-primary/20"
                required
              />
            </label>

            <label className="mt-4 block">
              <span className="mb-2 block text-xs font-medium text-muted-foreground">密码</span>
              <input
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                type="password"
                autoComplete="current-password"
                className="h-11 w-full rounded-2xl border border-border/70 bg-background/55 px-4 text-sm text-foreground outline-none transition focus:border-primary/50 focus:ring-1 focus:ring-primary/20"
                required
              />
            </label>

            {error ? (
              <div className="mt-4 rounded-2xl border border-red-500/25 bg-red-500/10 px-4 py-3 text-sm text-red-300">
                {error}
              </div>
            ) : null}

            <button
              type="submit"
              disabled={pending || checking}
              className="mt-6 flex min-h-11 w-full items-center justify-center gap-2 rounded-2xl bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {pending || checking ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
              登录后台
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
