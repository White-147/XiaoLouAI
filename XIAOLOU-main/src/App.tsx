import { Suspense, lazy, type ReactNode } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import Layout from "./components/Layout";
import Home from "./pages/Home";
import ScriptPlaza from "./pages/ScriptPlaza";
import ApiCenter from "./pages/ApiCenter";
import ComicShell from "./pages/comic/ComicShell";
import GlobalSettings from "./pages/comic/GlobalSettings";
import StoryScript from "./pages/comic/StoryScript";
import Entities from "./pages/comic/Entities";
import Storyboard from "./pages/comic/Storyboard";
import Video from "./pages/comic/Video";
import Dubbing from "./pages/comic/Dubbing";
import Preview from "./pages/comic/Preview";
import Assets from "./pages/Assets";
import WalletRecharge from "./pages/WalletRecharge";
import EnterpriseConsole from "./pages/EnterpriseConsole";
// Playground is rendered persistently in Layout.tsx (keep-alive).

const ImageCreate = lazy(() => import("./pages/create/ImageCreate"));
const VideoCreate = lazy(() => import("./pages/create/VideoCreate"));
// Placeholder components for other routes
const Placeholder = ({ title }: { title: string }) => (
  <div className="flex-1 flex items-center justify-center text-muted-foreground">
    <h2 className="text-2xl font-medium">{title}</h2>
  </div>
);

const CanvasRoutePlaceholder = () => null;
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
          <Route path="enterprise" element={<EnterpriseConsole />} />
          <Route path="wallet/recharge" element={<WalletRecharge />} />
          <Route path="script-plaza" element={<ScriptPlaza />} />
          
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
            <Route path="canvas" element={<CanvasRoutePlaceholder />} />
          </Route>

          <Route path="comic" element={<ComicShell />}>
            <Route path="global" element={<GlobalSettings />} />
            <Route path="script" element={<StoryScript />} />
            <Route path="entities" element={<Entities />} />
            <Route path="storyboard" element={<Storyboard />} />
            <Route path="video" element={<Video />} />
            <Route path="dubbing" element={<Dubbing />} />
            <Route path="preview" element={<Preview />} />
          </Route>

          <Route path="assets" element={<Assets />} />
          <Route path="tutorial" element={<Placeholder title="教程" />} />
          <Route path="api-center" element={<ApiCenter />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
