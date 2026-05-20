import { Suspense, lazy, type ReactNode } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import Layout from "./features/home/nav-layout/Layout";
import Home from "./features/home/Home";

const ScriptPlaza = lazy(() => import("./features/comic-production/script-plaza/ScriptPlaza"));
const ImageCreate = lazy(() => import("./features/create-image/image-create/ImageCreate"));
const VideoCreate = lazy(() => import("./features/create-video/video-create/VideoCreate"));
const VideoReplace = lazy(() => import("./features/toolbox/video-replace/VideoReplace"));
const ScriptBreakdown = lazy(() => import("./features/toolbox/script-breakdown/ScriptBreakdown"));
const VideoReverse = lazy(() => import("./features/toolbox/video-reverse/VideoReverse"));
const StoryboardGrid25 = lazy(() => import("./features/toolbox/storyboard-25/StoryboardGrid25"));
const CreditUsage = lazy(() => import("./features/wallet-payments-api-center/credit-usage/CreditUsage"));
const ComicShell = lazy(() => import("./features/comic-production/comic/ComicShell"));
const GlobalSettings = lazy(() => import("./features/comic-production/comic/GlobalSettings"));
const StoryScript = lazy(() => import("./features/comic-production/comic/StoryScript"));
const Entities = lazy(() => import("./features/comic-production/comic/Entities"));
const Storyboard = lazy(() => import("./features/comic-production/comic/Storyboard"));
const Video = lazy(() => import("./features/comic-production/comic/Video"));
const Dubbing = lazy(() => import("./features/comic-production/comic/Dubbing"));
const Preview = lazy(() => import("./features/comic-production/comic/Preview"));
const Assets = lazy(() => import("./features/assets-media-projects/assets/Assets"));
const WalletRecharge = lazy(() => import("./features/wallet-payments-api-center/wallet-recharge/WalletRecharge"));
const ApiCenter = lazy(() => import("./features/wallet-payments-api-center/api-center/ApiCenter"));
const EnterpriseConsole = lazy(() => import("./features/account-admin-enterprise/enterprise-console/EnterpriseConsole"));
const SuperAdminConsole = lazy(() => import("./features/account-admin-enterprise/super-admin-console/SuperAdminConsole"));
// Placeholder components for other routes
const Placeholder = ({ title }: { title: string }) => (
  <div className="flex-1 flex items-center justify-center text-muted-foreground">
    <h2 className="text-2xl font-medium">{title}</h2>
  </div>
);

const CanvasRoutePlaceholder = () => null;
const AgentCanvasRoutePlaceholder = () => null;
const PlaygroundRoutePlaceholder = () => null;

function DeferredRoute(props: { children: ReactNode }) {
  return (
    <Suspense
      fallback={
        <div className="flex h-full min-h-0 flex-1 items-center justify-center text-sm text-muted-foreground">
          页面加载中...
        </div>
      }
    >
      {props.children}
    </Suspense>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<Navigate to="/home" replace />} />
          <Route path="home" element={<Home />} />
          <Route path="playground/*" element={<PlaygroundRoutePlaceholder />} />
          <Route
            path="enterprise"
            element={
              <DeferredRoute>
                <EnterpriseConsole />
              </DeferredRoute>
            }
          />
          <Route
            path="wallet/recharge"
            element={
              <DeferredRoute>
                <WalletRecharge />
              </DeferredRoute>
            }
          />
          <Route
            path="wallet/usage"
            element={
              <DeferredRoute>
                <CreditUsage />
              </DeferredRoute>
            }
          />
          <Route
            path="admin"
            element={
              <DeferredRoute>
                <SuperAdminConsole />
              </DeferredRoute>
            }
          />
          <Route path="admin/login" element={<Placeholder title="管理员登录入口 / Admin access shell" />} />
          <Route
            path="script-plaza"
            element={
              <DeferredRoute>
                <ScriptPlaza />
              </DeferredRoute>
            }
          />
          
          <Route path="create">
            <Route
              path="image"
              element={
                <DeferredRoute>
                  <ImageCreate />
                </DeferredRoute>
              }
            />
            <Route
              path="video"
              element={
                <DeferredRoute>
                  <VideoCreate />
                </DeferredRoute>
              }
            />
            <Route
              path="video-replace"
              element={
                <DeferredRoute>
                  <VideoReplace />
                </DeferredRoute>
              }
            />
            <Route
              path="script-breakdown"
              element={
                <DeferredRoute>
                  <ScriptBreakdown />
                </DeferredRoute>
              }
            />
            <Route
              path="video-reverse"
              element={
                <DeferredRoute>
                  <VideoReverse />
                </DeferredRoute>
              }
            />
            <Route
              path="storyboard-25"
              element={
                <DeferredRoute>
                  <StoryboardGrid25 />
                </DeferredRoute>
              }
            />
            <Route path="canvas" element={<CanvasRoutePlaceholder />} />
            <Route path="agent-canvas" element={<AgentCanvasRoutePlaceholder />} />
          </Route>

          <Route
            path="comic"
            element={
              <DeferredRoute>
                <ComicShell />
              </DeferredRoute>
            }
          >
            <Route path="global" element={<GlobalSettings />} />
            <Route path="script" element={<StoryScript />} />
            <Route path="entities" element={<Entities />} />
            <Route path="storyboard" element={<Storyboard />} />
            <Route path="video" element={<Video />} />
            <Route path="dubbing" element={<Dubbing />} />
            <Route path="preview" element={<Preview />} />
          </Route>

          <Route
            path="assets"
            element={
              <DeferredRoute>
                <Assets />
              </DeferredRoute>
            }
          />
          <Route path="tutorial" element={<Placeholder title="教程" />} />
          <Route
            path="api-center"
            element={
              <DeferredRoute>
                <ApiCenter />
              </DeferredRoute>
            }
          />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
