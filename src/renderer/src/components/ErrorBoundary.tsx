import { Component, type ReactNode } from 'react'

/** Contains a render crash to one panel instead of blanking the whole window. */
export class ErrorBoundary extends Component<{ children: ReactNode; label: string }, { error: Error | null }> {
  state = { error: null as Error | null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="empty">
        <div>{this.props.label} crashed.</div>
        <pre className="preview mono small" style={{ maxWidth: 640, textAlign: 'left' }}>
          {this.state.error.message}
        </pre>
        <button className="btn outline" onClick={() => this.setState({ error: null })}>
          Try again
        </button>
      </div>
    )
  }
}
