import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RotateCw } from 'lucide-react';
import i18n from '@/i18n';

/**
 * A page that throws while rendering would otherwise take the whole app down to a blank
 * screen. This shows what happened and a way out. The cause goes to the console only.
 * Give it a `key` of the current path so moving to another page clears the failure.
 */
export class PageErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Page failed to render', error, info.componentStack);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div role="alert" data-page-error className="flex min-h-full items-center justify-center bg-slate-950 p-6">
        <div className="max-w-md rounded-xl border border-amber-800 bg-slate-900 p-6 text-center">
          <AlertTriangle className="mx-auto mb-3 h-8 w-8 text-amber-400" />
          <h2 className="text-base font-semibold text-slate-100">{i18n.t('common.pageError.title')}</h2>
          <p className="mt-2 text-sm text-slate-400">{i18n.t('common.pageError.body')}</p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-4 inline-flex items-center gap-2 rounded-lg bg-cyan-600 px-4 py-2 text-sm font-medium text-white hover:bg-cyan-500"
          >
            <RotateCw className="h-4 w-4" />
            {i18n.t('common.pageError.reload')}
          </button>
        </div>
      </div>
    );
  }
}
