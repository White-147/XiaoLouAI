/**
 * 视频结果节点：右侧竖向浮层。圆角方形外壳（非胶囊）；缩起仅图标，悬停展开为图二式文案+行高亮；下载区为浅底分区。
 */
import React, { useState } from 'react';
import { Download, History } from 'lucide-react';
import { IconHDSquare, IconRemoveBackground, type ImageNodeToolbarActionId } from './ImageNodeFloatingToolbar';

type VideoNodeFloatingToolbarProps = {
  nodeId: string;
  isDark: boolean;
  resultUrl: string;
  onToolbarAction?: (nodeId: string, action: ImageNodeToolbarActionId) => void;
};

const ROW_CLS = 'flex w-full min-w-0 items-center rounded-lg transition-colors';
const BTN_INNER =
  'text-[12px] font-medium tracking-tight ' +
  'text-left whitespace-nowrap select-none ' +
  'text-[#1a1a1a] dark:text-[#e8e6e0]';
const HD_BOX = 'flex h-9 w-9 shrink-0 items-center justify-center text-[#1a1a1a] dark:text-[#e8e6e0]';
/** 外轮廓：图二 12–16px 级圆角，不用 rounded-full 避免长条变胶囊 */
const SHELL = [
  'flex max-h-[min(90vh,520px)] flex-col gap-0.5 overflow-hidden rounded-2xl border shadow-lg transition-[min-width] duration-200 ease-out',
  'border-[rgba(0,0,0,0.08)] bg-white shadow-[0_2px_16px_rgba(0,0,0,0.08),0_0_1px_rgba(0,0,0,0.04)]',
  'dark:border-white/10 dark:bg-[#1a1916] dark:shadow-[0_8px_32px_rgba(0,0,0,0.45)]',
].join(' ');
const ROW_HOVER = (isDark: boolean, on: boolean) =>
  on ? (isDark ? 'bg-white/[0.1]' : 'bg-[#f0f0f0]') : '';

export const VideoNodeFloatingToolbar: React.FC<VideoNodeFloatingToolbarProps> = ({
  nodeId,
  isDark,
  resultUrl,
  onToolbarAction,
}) => {
  const [panelHover, setPanelHover] = useState(false);
  const [rowHover, setRowHover] = useState<number | null>(null);

  const onRowEnter = (i: number) => setRowHover(i);
  const onRowLeave = () => setRowHover(null);

  const runAction = (id: ImageNodeToolbarActionId) => {
    onToolbarAction?.(nodeId, id);
  };

  const doDownload = () => {
    runAction('download');
    const filename = `video_${nodeId}.mp4`;
    const cleanUrl = resultUrl.split('?')[0];
    if (resultUrl.startsWith('data:')) {
      const link = document.createElement('a');
      link.href = resultUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      return;
    }
    fetch(cleanUrl, { cache: 'no-store' })
      .then((r) => r.blob())
      .then((blob) => {
        const u = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = u;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        window.URL.revokeObjectURL(u);
      })
      .catch(() => {
        const link = document.createElement('a');
        link.href = cleanUrl;
        link.download = filename;
        link.target = '_blank';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      });
  };

  return (
    <div
      className={`${SHELL} ${panelHover ? 'min-w-[132px] p-1.5' : 'w-9 py-1.5'}`}
      onMouseEnter={() => setPanelHover(true)}
      onMouseLeave={() => {
        setPanelHover(false);
        setRowHover(null);
      }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        className={`${ROW_CLS} min-h-9 ${ROW_HOVER(isDark, rowHover === 0)} ${panelHover ? 'px-1' : 'justify-center'}`}
        onPointerDown={(e) => e.stopPropagation()}
        onMouseEnter={() => onRowEnter(0)}
        onMouseLeave={onRowLeave}
        title="放大"
        onClick={() => runAction('upscale')}
      >
        <span className={HD_BOX}>
          <IconHDSquare />
        </span>
        {panelHover ? <span className={`${BTN_INNER} flex-1 pr-0.5`}>放大</span> : null}
      </button>

      <button
        type="button"
        className={`${ROW_CLS} min-h-9 ${ROW_HOVER(isDark, rowHover === 1)} ${panelHover ? 'px-1' : 'justify-center'}`}
        onPointerDown={(e) => e.stopPropagation()}
        onMouseEnter={() => onRowEnter(1)}
        onMouseLeave={onRowLeave}
        title="去除背景"
        onClick={() => runAction('removeBackground')}
      >
        <span className={HD_BOX}>
          <IconRemoveBackground />
        </span>
        {panelHover ? <span className={`${BTN_INNER} flex-1 pr-0.5`}>去除背景</span> : null}
      </button>

      <div
        role="presentation"
        className={`${ROW_CLS} min-h-9 cursor-not-allowed opacity-50 ${ROW_HOVER(isDark, rowHover === 2)} ${panelHover ? 'px-1' : 'justify-center'}`}
        onMouseEnter={() => onRowEnter(2)}
        onMouseLeave={onRowLeave}
        title="视频延长"
      >
        <span className={HD_BOX}>
          <History className="h-[18px] w-[18px]" strokeWidth={1.4} />
        </span>
        {panelHover ? <span className={`${BTN_INNER} flex-1 pr-0.5`}>视频延长</span> : null}
      </div>

      <div
        className={`mt-0.5 w-full rounded-lg p-0.5 ${isDark ? 'bg-white/[0.07]' : 'bg-[#ededed]'}`}
      >
        <button
          type="button"
          className={`${ROW_CLS} min-h-8 w-full ${ROW_HOVER(isDark, rowHover === 3)} ${panelHover ? 'px-1' : 'justify-center'}`}
          onPointerDown={(e) => e.stopPropagation()}
          onMouseEnter={() => onRowEnter(3)}
          onMouseLeave={onRowLeave}
          title="下载"
          onClick={doDownload}
        >
          <span className={HD_BOX}>
            <Download className="h-[18px] w-[18px] shrink-0" strokeWidth={1.4} aria-hidden />
          </span>
          {panelHover ? <span className={`${BTN_INNER} flex-1 pr-0.5`}>下载</span> : null}
        </button>
      </div>
    </div>
  );
};
