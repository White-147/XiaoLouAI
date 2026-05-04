import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useEffect, useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';

interface UninstallProgressDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUninstallComplete?: () => void;
  onConfirmUninstall?: () => void;
}

interface ProgressData {
  percent: number;
  status: string;
}

interface LogData {
  message: string;
}

const UninstallProgressDialog = ({ open, onOpenChange, onUninstallComplete, onConfirmUninstall }: UninstallProgressDialogProps) => {
  const { t } = useTranslation();
  const [progress, setProgress] = useState(0);
  const [logs, setLogs] = useState<string[]>([t('settings:comfyui.uninstallProgress.preparing')]);
  const [isCompleted, setIsCompleted] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [isConfirming, setIsConfirming] = useState(true);
  const logContainerRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when logs change
  useEffect(() => {
    if (logContainerRef.current) {
      // Find the scrollable viewport within ScrollArea
      const scrollableElement = logContainerRef.current.closest('[data-radix-scroll-area-viewport]') as HTMLElement;
      if (scrollableElement) {
        scrollableElement.scrollTop = scrollableElement.scrollHeight;
      } else {
        // Fallback: try to scroll the parent element
        const parent = logContainerRef.current.parentElement;
        if (parent) {
          parent.scrollTop = parent.scrollHeight;
        }
      }
    }
  }, [logs]);

  useEffect(() => {
    if (!open) {
      // Reset state when dialog closes
      setProgress(0);
      setLogs([t('settings:comfyui.uninstallProgress.preparing')]);
      setIsCompleted(false);
      setHasError(false);
      setIsConfirming(true);
      return;
    }

    // Skip event listeners if still confirming
    if (isConfirming) {
      return;
    }

    // Listen for uninstallation progress events
    const handleProgress = (event: CustomEvent<ProgressData>) => {
      const { percent } = event.detail;
      setProgress(percent);

      if (percent >= 100) {
        setIsCompleted(true);
        setTimeout(() => {
          onUninstallComplete?.();
          onOpenChange(false);
        }, 2000);
      }
    };

    const handleLog = (event: CustomEvent<LogData>) => {
      const { message } = event.detail;
      setLogs(prev => [...prev, message]);

      // Check for error messages
      if (message.toLowerCase().includes('error') || message.toLowerCase().includes('failed')) {
        setHasError(true);
      }

      // Check for completion message
      if (message.includes('completed successfully')) {
        setIsCompleted(true);
        setTimeout(() => {
          onUninstallComplete?.();
          onOpenChange(false);
        }, 2000);
      }
    };

    const handleError = (event: CustomEvent<{ error: string }>) => {
      const { error } = event.detail;
      setHasError(true);
      setLogs(prev => [...prev, `Error: ${error}`]);
    };

    // Add event listeners
    window.addEventListener('comfyui-uninstall-progress', handleProgress as EventListener);
    window.addEventListener('comfyui-uninstall-log', handleLog as EventListener);
    window.addEventListener('comfyui-uninstall-error', handleError as EventListener);

    return () => {
      // Remove event listeners
      window.removeEventListener('comfyui-uninstall-progress', handleProgress as EventListener);
      window.removeEventListener('comfyui-uninstall-log', handleLog as EventListener);
      window.removeEventListener('comfyui-uninstall-error', handleError as EventListener);
    };
  }, [open, onUninstallComplete, onOpenChange, isConfirming, t]);

  const handleConfirm = () => {
    setIsConfirming(false);
    onConfirmUninstall?.();
  };

  const handleCancel = () => {
    onOpenChange(false);
  };

  const handleClose = () => {
    if (!isCompleted && !hasError && !isConfirming) {
      // Don't allow closing during uninstallation unless there's an error
      return;
    }
    onOpenChange(false);
  };

  const canClose = isCompleted || hasError || isConfirming;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>🗑️ {t('settings:comfyui.uninstallButton')}</DialogTitle>
        </DialogHeader>

        {isConfirming ? (
          // Confirmation view
          <div className="py-4">
            <p className="text-sm text-muted-foreground">
              {t('settings:comfyui.confirmUninstall')}
            </p>
          </div>
        ) : (
          // Progress view
          <div className="space-y-4">
            {/* Progress Bar */}
            <div className="space-y-2">
              <Progress value={progress} className="w-full" />
              <div className="text-sm text-muted-foreground text-center">
                {Math.round(progress)}%
              </div>
            </div>

            {/* Log Area */}
            <div className="space-y-2">
              <div className="text-sm font-medium">{t('settings:comfyui.uninstallProgress.logTitle')}</div>
              <ScrollArea className="h-48 w-full border rounded-md p-3">
                <div className="space-y-1 font-mono text-xs" ref={logContainerRef}>
                  {logs.map((log, index) => (
                    <div
                      key={index}
                      className={`break-all whitespace-pre-wrap ${log.toLowerCase().includes('error') || log.toLowerCase().includes('failed')
                        ? 'text-red-600 dark:text-red-400'
                        : log.toLowerCase().includes('success') || log.toLowerCase().includes('completed')
                          ? 'text-green-600 dark:text-green-400'
                          : 'text-foreground'
                        }`}
                    >
                      {log}
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </div>
          </div>
        )}

        <DialogFooter className="flex justify-end">
          {isConfirming ? (
            <div className="flex gap-2">
              <Button variant="outline" onClick={handleCancel}>
                {t('settings:cancel')}
              </Button>
              <Button variant="destructive" onClick={handleConfirm}>
                {t('settings:comfyui.confirmUninstallButton')}
              </Button>
            </div>
          ) : canClose ? (
            <Button onClick={handleClose}>
              {t('settings:close')}
            </Button>
          ) : (
            <div className="text-sm text-muted-foreground">
              {t('settings:comfyui.uninstallProgress.inProgress')}
            </div>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default UninstallProgressDialog;
