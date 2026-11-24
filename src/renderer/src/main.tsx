import { createRoot } from 'react-dom/client'
import { App } from './App'
import '@fontsource-variable/geist'
import '@fontsource-variable/jetbrains-mono'
import { monaco, setSnippetSource, setupMonaco } from './editor/monaco'
import { IS_MAC, useApp } from './store'
import './styles.css'

// the toolbar leaves room for the macOS window buttons only where they exist
document.documentElement.classList.toggle('mac', IS_MAC)
setupMonaco()
setSnippetSource(() => useApp.getState().snippets)
// Monaco measures glyphs once; re-measure after the bundled fonts arrive so carets line up
void document.fonts.ready.then(() => monaco.editor.remeasureFonts())
createRoot(document.getElementById('root')!).render(<App />)
