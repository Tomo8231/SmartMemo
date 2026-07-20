import React from 'react';

type Props = { children: React.ReactNode };
type State = { error: Error | null };

// レンダー中の例外でアプリ全体がグレー画面のまま固まるのを防ぐ。
// 例外時は復旧用のメッセージと再読み込みボタンを表示する。
export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // 端末上のログにも残す
    console.error('[SmartMemo crash]', error, info);
  }

  handleReload = () => {
    this.setState({ error: null });
    window.location.reload();
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div
        style={{
          position: 'fixed', inset: 0, display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', gap: 14, padding: 24,
          background: '#fafaf9', color: '#1a1a18', textAlign: 'center',
          fontFamily: 'system-ui, -apple-system, sans-serif',
        }}
      >
        <div style={{ fontSize: 40 }}>😿</div>
        <div style={{ fontSize: 16, fontWeight: 700 }}>問題が発生しました</div>
        <div style={{ fontSize: 13, color: '#6a6a68', maxWidth: 320, lineHeight: 1.7 }}>
          画面の描画中にエラーが起きました。再読み込みで復帰できることが多いです。
        </div>
        <pre
          style={{
            fontSize: 11, color: '#a0392b', background: '#fdf0f0',
            border: '1px solid #f0d0d0', borderRadius: 8, padding: '8px 10px',
            maxWidth: 320, maxHeight: 120, overflow: 'auto', whiteSpace: 'pre-wrap',
            textAlign: 'left', margin: 0,
          }}
        >
          {String(error.message || error)}
        </pre>
        <button
          onClick={this.handleReload}
          style={{
            marginTop: 4, padding: '11px 26px', border: 'none', borderRadius: 12,
            background: '#D4622A', color: '#fff', fontSize: 14, fontWeight: 700,
            cursor: 'pointer', fontFamily: 'inherit',
          }}
        >
          再読み込み
        </button>
      </div>
    );
  }
}
