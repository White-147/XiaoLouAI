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

interface InstallProgressDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onInstallComplete?: () => void;
}

interface ProgressData {
  percent: number;
  status: string;
}

interface LogData {
  message: string;
}

const InstallProgressDialog = ({ open, onOpenChange, onInstallComplete }: InstallProgressDialogProps) => {
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState("Preparing to start download...");
  const [logs, setLogs] = useState<string[]>(["Waiting to start..."]);
  const [isCompleted, setIsCompleted] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [isCancelled, setIsCancelled] = useState(false);
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
      setStatus("Preparing to start download...");
      setLogs(["Waiting to start..."]);
      setIsCompleted(false);
      setHasError(false);
      setIsCancelling(false);
      setIsCancelled(false);
      return;
    }

    // Listen for installation progress events
    const handleProgress = (event: CustomEvent<ProgressData>) => {
      const { percent, status } = event.detail;
      setProgress(percent);
      setStatus(status);

      if (percent >= 100) {
        setIsCompleted(true);
        setTimeout(() => {
          onInstallComplete?.();
          onOpenChange(false);
        }, 3000);
      }
    };

    const handleLog = (event: CustomEvent<LogData>) => {
      const { message } = event.detail;
      setLogs(prev => [...prev, message]);

      // Check for error messages
      if (message.toLowerCase().includes('error') || message.toLowerCase().includes('failed')) {
        setHasError(true);
      }
    };

    const handleError = (event: CustomEvent<{ error: string }>) => {
      const { error } = event.detail;
      setHasError(true);
      setStatus(`Installation failed: ${error}`);
      setLogs(prev => [...prev, `Error: ${error}`]);
    };

    const handleCancelled = (event: CustomEvent<{ message: string }>) => {
      const { message } = event.detail;
      setIsCancelled(true);
      setIsCancelling(false);
      setStatus('Installation cancelled');
      setLogs(prev => [...prev, `Cancelled: ${message}`]);
    };

    // Add event listeners
    window.addEventListener('comfyui-install-progress', handleProgress as EventListener);
    window.addEventListener('comfyui-install-log', handleLog as EventListener);
    window.addEventListener('comfyui-install-error', handleError as EventListener);
    window.addEventListener('comfyui-install-cancelled', handleCancelled as EventListener);

    return () => {
      // Remove event listeners
      window.removeEventListener('comfyui-install-progress', handleProgress as EventListener);
      window.removeEventListener('comfyui-install-log', handleLog as EventListener);
      window.removeEventListener('comfyui-install-error', handleError as EventListener);
      window.removeEventListener('comfyui-install-cancelled', handleCancelled as EventListener);
    };
  }, [open, onInstallComplete, onOpenChange]);

  const handleClose = () => {
    if (!isCompleted && !hasError && !isCancelled) {
      // Don't allow closing during installation unless there's an error or it's cancelled
      return;
    }
    onOpenChange(false);
  };

  const handleCancel = async () => {
    if (isCompleted || hasError || isCancelling || isCancelled) {
      return;
    }

    setIsCancelling(true);
    setStatus('Cancelling installation...');
    setLogs(prev => [...prev, 'User requested cancellation...']);

    try {
      // Call electron API to cancel installation
      if (window.electronAPI?.cancelComfyUIInstall) {
        await window.electronAPI.cancelComfyUIInstall();
      }
    } catch (error) {
      console.error('Failed to cancel installation:', error);
      setLogs(prev => [...prev, `Failed to cancel: ${error}`]);
    }
  };

  const canCancel = !isCompleted && !hasError && !isCancelling && !isCancelled;
  const canClose = isCompleted || hasError || isCancelled;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>🎨 Installing Flux Image Generation Model</DialogTitle>
          <DialogDescription>
            {status}
          </DialogDescription>
        </DialogHeader>

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
            <div className="text-sm font-medium">Installation Log:</div>
            <ScrollArea className="h-48 w-full border rounded-md p-3">
              <div className="space-y-1 font-mono text-xs" ref={logContainerRef}>
                {logs.map((log, index) => (
                  <div
                    key={index}
                    className={`break-all whitespace-pre-wrap ${log.toLowerCase().includes('error') || log.toLowerCase().includes('failed')
                      ? 'text-red-600 dark:text-red-400'
                      : log.toLowerCase().includes('success') || log.toLowerCase().includes('completed')
                        ? 'text-green-600 dark:text-green-400'
                        : log.toLowerCase().includes('cancel')
                          ? 'text-yellow-600 dark:text-yellow-400'
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

        <DialogFooter className="flex justify-between">
          <div className="flex gap-2">
            {canCancel && (
              <Button
                variant="outline"
                onClick={handleCancel}
                disabled={isCancelling}
              >
                {isCancelling ? "Cancelling..." : "Cancel Installation"}
              </Button>
            )}
          </div>

          <div className="flex gap-2">
            {canClose && (
              <Button onClick={handleClose}>
                Close
              </Button>
            )}
            {!canClose && !canCancel && (
              <div className="text-sm text-muted-foreground">
                Installation in progress... Please wait.
              </div>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default InstallProgressDialog;
