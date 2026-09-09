// src/components/ErrorBoundary.tsx
// 顶层错误边界：任何渲染/生命周期异常都不会再让整个应用黑屏，
// 而是显示可读的错误卡片，并提供"重试"（重建子树）。
import React from 'react';
import { FaExclamationTriangle, FaRedo } from 'react-icons/fa';

interface Props {
  children: React.ReactNode;
}

interface State {
  hasError: boolean;
  message: string;
  resetKey: number;
}

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, message: '', resetKey: 0 };
  }

  static getDerivedStateFromError(err: unknown): Partial<State> {
    return { hasError: true, message: err instanceof Error ? err.message : String(err) };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error('[error-boundary]', error, info.componentStack);
  }

  private handleReset = (): void => {
    this.setState((s) => ({ hasError: false, message: '', resetKey: s.resetKey + 1 }));
  };

  render(): React.ReactNode {
    if (this.state.hasError) {
      return (
        <div className="min-h-[60vh] flex items-center justify-center p-6">
          <div className="max-w-md w-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-8 text-center shadow-sm">
            <FaExclamationTriangle className="w-10 h-10 text-yellow-500 mx-auto mb-4" />
            <h1 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">
              界面出了点问题
            </h1>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-1">
              已由错误边界拦截，应用主体仍可继续使用。
            </p>
            <p className="text-xs font-mono bg-gray-100 dark:bg-gray-700 rounded p-2 mb-6 text-gray-600 dark:text-gray-300 break-all text-left">
              {this.state.message || '未知错误'}
            </p>
            <button
              onClick={this.handleReset}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-gray-900 dark:bg-white text-white dark:text-gray-900 text-sm font-medium hover:opacity-85"
            >
              <FaRedo className="w-3.5 h-3.5" />
              重试
            </button>
          </div>
        </div>
      );
    }
    return <React.Fragment key={this.state.resetKey}>{this.props.children}</React.Fragment>;
  }
}
