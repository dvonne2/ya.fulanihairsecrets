import React, { Component, ErrorInfo, ReactNode } from 'react';
import { reloadOnceForChunkError } from '@/utils/chunkReloadRecovery';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
}

class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    // Stale-deployment chunk failures get a single automatic reload
    // (loop-guarded); all other errors render the fallback screen below.
    if (reloadOnceForChunkError(error)) return;
    console.error('=== ERROR BOUNDARY CAUGHT ===');
    console.error('Error name:', error.name);
    console.error('Error message:', error.message);
    console.error('Error stack:', error.stack);
    console.error('Component stack:', errorInfo.componentStack);
    console.error('=== END ERROR BOUNDARY ===');
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback || (
        <div style={{ padding: '20px', textAlign: 'center' }}>
          <h2>Something went wrong</h2>
          <p>Please refresh the page and try again.</p>
          <button onClick={() => window.location.reload()}>
            Refresh Page
          </button>
          <details style={{ marginTop: '20px', textAlign: 'left', maxWidth: '800px', margin: '20px auto' }}>
            <summary style={{ cursor: 'pointer', color: '#666' }}>Error details (for debugging)</summary>
            <pre style={{ background: '#f5f5f5', padding: '12px', overflow: 'auto', fontSize: '11px', whiteSpace: 'pre-wrap' }}>
              {this.state.error?.message}{'\n\n'}{this.state.error?.stack}
            </pre>
          </details>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
