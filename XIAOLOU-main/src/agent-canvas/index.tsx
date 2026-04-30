import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles.css';

function normalizeFatalError(input: unknown): Error {
  if (input instanceof Error) return input;
  if (typeof input === 'string' && input.trim()) return new Error(input);
  return new Error('画布运行时发生未知错误。');
}

function FatalRuntimeOverlay({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#050505] p-6 text-white">
      <div className="w-full max-w-lg rounded-3xl border border-red-500/20 bg-black/80 p-6 shadow-2xl">
        <div className="mb-4 inline-flex rounded-full bg-red-500/10 px-3 py-1 text-xs font-medium text-red-300">
          画布运行时异常
        </div>
        <h1 className="text-2xl font-semibold">画布暂时无法继续运行</h1>
        <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-neutral-300">{message}</p>
        <div className="mt-6 flex flex-wrap gap-3">
          <button
            onClick={onRetry}
            className="rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-500"
          >
            重试画布运行时
          </button>
          <button
            onClick={() => window.location.reload()}
            className="rounded-xl border border-neutral-700 px-4 py-2.5 text-sm font-medium text-neutral-200 transition-colors hover:bg-neutral-900"
          >
            重新打开画布
          </button>
        </div>
      </div>
    </div>
  );
}

class CanvasRuntimeErrorBoundary extends React.Component<
  {
    children: React.ReactNode;
    onFatalError: (error: Error) => void;
  }
> {
  componentDidCatch(error: Error) {
    console.error('[CanvasRuntime] React render error:', error);
    this.props.onFatalError(error);
  }

  render() {
    return this.props.children;
  }
}

function CanvasRuntimeRoot() {
  const [fatalError, setFatalError] = React.useState<Error | null>(null);
  const [retryToken, setRetryToken] = React.useState(0);

  React.useEffect(() => {
    const handleWindowError = (event: ErrorEvent) => {
      const error = normalizeFatalError(event.error || event.message);
      console.error('[CanvasRuntime] window error:', error);
      setFatalError(error);
    };

    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      const error = normalizeFatalError(event.reason);
      console.error('[CanvasRuntime] unhandled rejection:', error);
      setFatalError(error);
    };

    window.addEventListener('error', handleWindowError);
    window.addEventListener('unhandledrejection', handleUnhandledRejection);

    return () => {
      window.removeEventListener('error', handleWindowError);
      window.removeEventListener('unhandledrejection', handleUnhandledRejection);
    };
  }, []);

  const handleRetry = React.useCallback(() => {
    setFatalError(null);
    setRetryToken((current) => current + 1);
  }, []);

  if (fatalError) {
    return (
      <FatalRuntimeOverlay
        message={fatalError.message || '画布运行时发生未知错误。'}
        onRetry={handleRetry}
      />
    );
  }

  return (
    <CanvasRuntimeErrorBoundary key={retryToken} onFatalError={setFatalError}>
      <React.StrictMode>
        <App key={retryToken} />
      </React.StrictMode>
    </CanvasRuntimeErrorBoundary>
  );
}

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Could not find root element to mount to');
}

const root = ReactDOM.createRoot(rootElement);
root.render(<CanvasRuntimeRoot />);
