import { createRoot } from 'react-dom/client'
import { App } from './App'
import '@fontsource-variable/geist'
import '@fontsource-variable/jetbrains-mono'
import { monaco, setSnippetSource, setupMonaco } from './editor/monaco'
import { useApp } from './store'
import './styles.css'

setupMonaco()
setSnippetSource(() => useApp.getState().snippets)
// Monaco measures glyphs once; re-measure after the bundled fonts arrive so carets line up
void document.fonts.ready.then(() => monaco.editor.remeasureFonts())
createRoot(document.getElementById('root')!).render(<App />)
