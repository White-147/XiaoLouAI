import { Suspense, lazy, type ReactNode } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import Layout from "./components/Layout";
import Home from "./pages/Home";

const ScriptPlaza = lazy(() => import("./pages/ScriptPlaza"));
const ImageCreate = lazy(() => import("./pages/create/ImageCreate"));
const VideoCreate = lazy(() => import("./pages/create/VideoCreate"));
const VideoReplace = lazy(() => import("./pages/create/VideoReplace"));
const ScriptBreakdown = lazy(() => import("./pages/create/ScriptBreakdown"));
const VideoReverse = lazy(() => import("./pages/create/VideoReverse"));
const StoryboardGrid25 = lazy(() => import("./pages/create/StoryboardGrid25"));
const Playground = lazy(() => import("./pages/Playground"));
const CreditUsage = lazy(() => import("./pages/CreditUsage"));
const ComicShell = lazy(() => import("./pages/comic/ComicShell"));
const GlobalSettings = lazy(() => import("./pages/comic/GlobalSettings"));
const StoryScript = lazy(() => import("./pages/comic/StoryScript"));
const Entities = lazy(() => import("./pages/comic/Entities"));
const Storyboard = lazy(() => import("./pages/comic/Storyboard"));
const Video = lazy(() => import("./pages/comic/Video"));
const Dubbing = lazy(() => import("./pages/comic/Dubbing"));
const Preview = lazy(() => import("./pages/comic/Preview"));
const Assets = lazy(() => import("./pages/Assets"));
const WalletRecharge = lazy(() => import("./pages/WalletRecharge"));
const ApiCenter = lazy(() => import("./pages/ApiCenter"));
const EnterpriseConsole = lazy(() => import("./pages/EnterpriseConsole"));
const AdminOrders = lazy(() => import("./pages/AdminOrders"));
const AdminLogin = lazy(() => import("./pages/AdminLogin"));
// Placeholder components for other routes
const Placeholder = ({ title }: { title: string }) => (
  <div className="flex-1 flex items-center justify-center text-muted-foreground">
    <h2 className="text-2xl font-medium">{title}</h2>
  </div>
);

const CanvasRoutePlaceholder = () => null;
const AgentCanvasRoutePlaceholder = () => null;
const AgentStudioRoutePlaceholder = () => null;

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
          <Route
            path="playground/*"
            element={
              <DeferredRoute>
                <Playground />
              </DeferredRoute>
            }
          />
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
            path="admin/login"
            element={
              <DeferredRoute>
                <AdminLogin />
              </DeferredRoute>
            }
          />
          <Route
            path="admin/orders"
            element={
              <DeferredRoute>
                <AdminOrders />
              </DeferredRoute>
            }
          />
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
            <Route path="agent-studio" element={<AgentStudioRoutePlaceholder />} />
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
