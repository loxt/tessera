// Single action catalog. Main builds the native menu from it, the renderer's keymap dispatcher
// and command palette use it. Default shortcuts follow DataGrip's macOS keymap;
// `dg` lists the equivalent DataGrip action ids
// so a user's DataGrip keymap can be imported (src/main/keymap-import.ts).

export type MenuName = 'File' | 'Edit' | 'View' | 'Navigate' | 'Database' | 'Window'

export interface ActionDef {
  id: string
  title: string
  menu?: MenuName
  /** default accelerator (Electron syntax) */
  accel?: string
  /** a second shortcut kept on top of any keymap, imported ones included, unless it collides */
  fallback?: string
  /** where the shortcut applies: everywhere, in the SQL editor, or in a data grid */
  scope?: 'global' | 'editor' | 'grid'
  /** equivalent DataGrip/IntelliJ action ids, in priority order */
  dg?: string[]
  separatorBefore?: boolean
}

export const ACTIONS: ActionDef[] = [
  { id: 'connection.new', title: 'New Data Source…', menu: 'File' },
  { id: 'connection.fromUrl', title: 'New Data Source from URL…', menu: 'File' },
  { id: 'console.new', title: 'Open Query Console…', menu: 'File', accel: 'CmdOrCtrl+Shift+L', dg: ['Jdbc.OpenConsole.New'] },
  { id: 'console.create', title: 'New Query Console', menu: 'File' },
  { id: 'console.rename', title: 'Rename Console…', menu: 'File' },
  { id: 'console.openFile', title: 'Open SQL File…', menu: 'File', accel: 'CmdOrCtrl+O', dg: ['OpenFile'] },
  { id: 'console.saveFile', title: 'Save Console As…', menu: 'File', accel: 'CmdOrCtrl+Shift+S', dg: ['SaveAs'] },
  { id: 'tab.close', title: 'Close Tab', menu: 'File', accel: 'CmdOrCtrl+W', dg: ['CloseContent'], separatorBefore: true },
  { id: 'tab.closeOthers', title: 'Close Other Tabs', menu: 'File', dg: ['CloseAllEditorsButActive'] },
  { id: 'tab.closeAll', title: 'Close All Tabs', menu: 'File', dg: ['CloseAllEditors'] },
  { id: 'settings.open', title: 'Settings…', menu: 'File', accel: 'CmdOrCtrl+,', dg: ['ShowSettings'], separatorBefore: true },
  { id: 'settings.keymap', title: 'Keymap…', menu: 'File' },
  { id: 'settings.snippets', title: 'Snippets…', menu: 'File' },

  { id: 'editor.format', title: 'Reformat SQL', menu: 'Edit', scope: 'editor', accel: 'CmdOrCtrl+Alt+L', dg: ['ReformatCode'] },
  { id: 'editor.saveSnippet', title: 'Save Selection as Snippet…', menu: 'Edit', scope: 'editor', dg: ['SaveAsTemplate'] },
  { id: 'editor.comment', title: 'Comment with Line Comment', menu: 'Edit', scope: 'editor', accel: 'CmdOrCtrl+/', dg: ['CommentByLineComment'] },
  { id: 'editor.blockComment', title: 'Comment with Block Comment', menu: 'Edit', scope: 'editor', accel: 'CmdOrCtrl+Alt+/', dg: ['CommentByBlockComment'] },
  { id: 'editor.duplicate', title: 'Duplicate Line or Selection', menu: 'Edit', scope: 'editor', accel: 'CmdOrCtrl+D', dg: ['EditorDuplicate'] },
  { id: 'editor.deleteLine', title: 'Delete Line', menu: 'Edit', scope: 'editor', accel: 'CmdOrCtrl+Backspace', dg: ['EditorDeleteLine'] },
  { id: 'editor.moveLineUp', title: 'Move Line Up', menu: 'Edit', scope: 'editor', accel: 'Alt+Shift+Up', dg: ['MoveLineUp'] },
  { id: 'editor.moveLineDown', title: 'Move Line Down', menu: 'Edit', scope: 'editor', accel: 'Alt+Shift+Down', dg: ['MoveLineDown'] },
  { id: 'editor.startNewLine', title: 'Start New Line', menu: 'Edit', scope: 'editor', accel: 'Shift+Enter', dg: ['EditorStartNewLine'] },
  { id: 'editor.joinLines', title: 'Join Lines', menu: 'Edit', scope: 'editor', accel: 'Ctrl+Shift+J', dg: ['EditorJoinLines'] },
  { id: 'editor.toggleCase', title: 'Toggle Case', menu: 'Edit', scope: 'editor', accel: 'CmdOrCtrl+Shift+U', dg: ['EditorToggleCase'] },
  { id: 'editor.expandSelection', title: 'Extend Selection', menu: 'Edit', scope: 'editor', accel: 'Alt+Up', dg: ['EditorSelectWord'], separatorBefore: true },
  { id: 'editor.shrinkSelection', title: 'Shrink Selection', menu: 'Edit', scope: 'editor', accel: 'Alt+Down', dg: ['EditorUnSelectWord'] },
  { id: 'editor.selectNextOccurrence', title: 'Add Selection for Next Occurrence', menu: 'Edit', scope: 'editor', accel: 'Ctrl+G', dg: ['SelectNextOccurrence'] },
  { id: 'editor.selectAllOccurrences', title: 'Select All Occurrences', menu: 'Edit', scope: 'editor', accel: 'Ctrl+CmdOrCtrl+G', dg: ['SelectAllOccurrences'] },
  { id: 'editor.unselectOccurrence', title: 'Unselect Occurrence', menu: 'Edit', scope: 'editor', accel: 'Ctrl+Shift+G', dg: ['UnselectPreviousOccurrence'] },
  { id: 'editor.cloneCaretAbove', title: 'Clone Caret Above', menu: 'Edit', scope: 'editor', dg: ['EditorCloneCaretAbove'] },
  { id: 'editor.cloneCaretBelow', title: 'Clone Caret Below', menu: 'Edit', scope: 'editor', dg: ['EditorCloneCaretBelow'] },
  { id: 'editor.complete', title: 'Basic Completion', menu: 'Edit', scope: 'editor', accel: 'Ctrl+Space', fallback: 'Alt+Space', dg: ['CodeCompletion'], separatorBefore: true },
  { id: 'editor.find', title: 'Find…', menu: 'Edit', scope: 'editor', accel: 'CmdOrCtrl+F', dg: ['Find'] },
  { id: 'editor.replace', title: 'Replace…', menu: 'Edit', scope: 'editor', accel: 'CmdOrCtrl+R', dg: ['Replace'] },
  { id: 'editor.gotoLine', title: 'Go to Line…', menu: 'Edit', scope: 'editor', accel: 'CmdOrCtrl+L', dg: ['GotoLine'] },
  { id: 'editor.fold', title: 'Collapse', menu: 'Edit', scope: 'editor', accel: 'CmdOrCtrl+-', dg: ['CollapseRegion'], separatorBefore: true },
  { id: 'editor.unfold', title: 'Expand', menu: 'Edit', scope: 'editor', accel: 'CmdOrCtrl+=', dg: ['ExpandRegion'] },
  { id: 'editor.foldAll', title: 'Collapse All', menu: 'Edit', scope: 'editor', accel: 'CmdOrCtrl+Shift+-', dg: ['CollapseAllRegions'] },
  { id: 'editor.unfoldAll', title: 'Expand All', menu: 'Edit', scope: 'editor', accel: 'CmdOrCtrl+Shift+=', dg: ['ExpandAllRegions'] },

  { id: 'search.everywhere', title: 'Search Everywhere', menu: 'Navigate', accel: 'Shift+Shift' },
  { id: 'search.actions', title: 'Find Action…', menu: 'Navigate', accel: 'CmdOrCtrl+Shift+A', dg: ['GotoAction'] },
  { id: 'search.tables', title: 'Go to Table…', menu: 'Navigate', accel: 'CmdOrCtrl+Shift+O', dg: ['GotoClass'] },
  { id: 'tab.recent', title: 'Recent Tabs', menu: 'Navigate', accel: 'CmdOrCtrl+E', dg: ['RecentFiles'] },
  { id: 'tab.next', title: 'Next Tab', menu: 'Navigate', accel: 'CmdOrCtrl+Shift+]', dg: ['NextTab'], separatorBefore: true },
  { id: 'tab.prev', title: 'Previous Tab', menu: 'Navigate', accel: 'CmdOrCtrl+Shift+[', dg: ['PreviousTab'] },
  { id: 'explorer.selectCurrent', title: 'Select in Database Explorer', menu: 'Navigate', accel: 'Alt+Shift+B', dg: ['sql.SelectInDatabaseView'] },

  { id: 'query.execute', title: 'Execute Statement', menu: 'Database', accel: 'CmdOrCtrl+Enter', dg: ['Console.Jdbc.Execute', 'Console.Execute.Multiline'] },
  { id: 'query.executeScript', title: 'Execute Script', menu: 'Database', accel: 'CmdOrCtrl+Alt+Enter' },
  { id: 'query.cancel', title: 'Cancel Running Statement', menu: 'Database', accel: 'CmdOrCtrl+F2', dg: ['Console.Jdbc.Cancel', 'Stop'] },
  { id: 'query.explain', title: 'Explain Plan', menu: 'Database', dg: ['Console.Jdbc.ExplainPlan'] },
  { id: 'query.explainAnalyze', title: 'Explain Analyse', menu: 'Database', dg: ['Console.Jdbc.ExplainAnalyse'] },
  { id: 'tx.commit', title: 'Commit', menu: 'Database', accel: 'CmdOrCtrl+Alt+Shift+Enter', dg: ['Console.Transaction.Commit'], separatorBefore: true },
  { id: 'tx.rollback', title: 'Rollback', menu: 'Database', dg: ['Console.Transaction.Rollback'] },
  { id: 'tx.toggleAuto', title: 'Toggle Auto-Commit', menu: 'Database' },
  { id: 'query.history', title: 'Query History', menu: 'Database', accel: 'CmdOrCtrl+Alt+E', dg: ['Console.Jdbc.BrowseHistory', 'Console.History.Browse'], separatorBefore: true },
  { id: 'query.runOnMany', title: 'Run on Several Data Sources…', menu: 'Database' },
  { id: 'schema.compare', title: 'Compare Schemas…', menu: 'Database', separatorBefore: true },
  { id: 'ai.ask', title: 'Ask AI to Write SQL…', menu: 'Database', accel: 'CmdOrCtrl+Shift+K', separatorBefore: true },
  { id: 'ai.explain', title: 'Explain Statement with AI', menu: 'Database' },
  { id: 'ai.fix', title: 'Fix Last Error with AI', menu: 'Database' },
  { id: 'explorer.refresh', title: 'Refresh', menu: 'Database', accel: 'CmdOrCtrl+Alt+Y', dg: ['Synchronize'] },
  { id: 'connection.properties', title: 'Data Source Properties…', menu: 'Database', accel: 'CmdOrCtrl+I', dg: ['DatabaseView.PropertiesAction'] },
  { id: 'object.ddl', title: 'Show DDL', menu: 'Database', accel: 'CmdOrCtrl+Alt+Shift+G', dg: ['DatabaseView.CopyDdlAction'] },
  { id: 'object.sqlGenerator', title: 'SQL Generator…', menu: 'Database', accel: 'CmdOrCtrl+Alt+G', dg: ['DatabaseView.SqlGenerator'] },
  { id: 'connection.disconnect', title: 'Disconnect', menu: 'Database' },

  { id: 'view.toggleExplorer', title: 'Toggle Database Explorer', menu: 'View', accel: 'CmdOrCtrl+1', dg: ['ActivateDatabaseToolWindow'] },
  { id: 'view.toggleResults', title: 'Toggle Results Panel', menu: 'View', accel: 'CmdOrCtrl+8', dg: ['ActivateServicesToolWindow'] },
  { id: 'view.fontIncrease', title: 'Increase Font Size', menu: 'View', accel: 'Ctrl+Shift+.', dg: ['EditorIncreaseFontSize', 'EditorIncreaseFontSizeGlobal'], separatorBefore: true },
  { id: 'view.fontDecrease', title: 'Decrease Font Size', menu: 'View', accel: 'Ctrl+Shift+,', dg: ['EditorDecreaseFontSize', 'EditorDecreaseFontSizeGlobal'] },
  { id: 'view.fontReset', title: 'Reset Font Size', menu: 'View', dg: ['EditorResetFontSize', 'EditorResetFontSizeGlobal'] },
  { id: 'view.splitRight', title: 'Split Right', menu: 'View', dg: ['SplitVertically'], separatorBefore: true },
  { id: 'view.splitDown', title: 'Split Down', menu: 'View', dg: ['SplitHorizontally'] },
  { id: 'view.unsplit', title: 'Unsplit', menu: 'View', dg: ['Unsplit', 'UnsplitAll'] },
  { id: 'tab.moveToOtherSplit', title: 'Move Tab to Opposite Split', menu: 'View', dg: ['MoveEditorToOppositeTabGroup'] },
  { id: 'view.nextSplit', title: 'Go to Next Split', menu: 'View', dg: ['NextSplitter'] },
  { id: 'view.prevSplit', title: 'Go to Previous Split', menu: 'View', dg: ['PrevSplitter'] },
  { id: 'view.chooseTheme', title: 'Choose Theme…', menu: 'View', separatorBefore: true },
  { id: 'view.toggleTheme', title: 'Toggle Light/Dark Theme', menu: 'View' },
  { id: 'view.notifications', title: 'Notifications', menu: 'View' },

  { id: 'grid.submit', title: 'Submit Changes', scope: 'grid', accel: 'CmdOrCtrl+Enter', dg: ['Console.TableResult.Submit'] },
  { id: 'grid.revert', title: 'Revert Selected Changes', scope: 'grid', accel: 'CmdOrCtrl+Alt+Z', dg: ['Console.TableResult.RevertSelected'] },
  { id: 'grid.addRow', title: 'Add Row', scope: 'grid', accel: 'CmdOrCtrl+N', dg: ['Console.TableResult.AddRow'] },
  { id: 'grid.cloneRow', title: 'Clone Row', scope: 'grid', accel: 'CmdOrCtrl+D', dg: ['Console.TableResult.CloneRow'] },
  { id: 'grid.deleteRows', title: 'Delete Rows', scope: 'grid', accel: 'CmdOrCtrl+Backspace', dg: ['Console.TableResult.DeleteRows'] },
  { id: 'grid.setNull', title: 'Set NULL', scope: 'grid', accel: 'CmdOrCtrl+Alt+N', dg: ['Console.TableResult.SetNull'] },
  { id: 'grid.viewer', title: 'Value Viewer', scope: 'grid', accel: 'Shift+Enter', dg: ['Console.TableResult.EditValueMaximized'] },
  { id: 'grid.export', title: 'Export Data…', scope: 'grid' }
]

export const actionById = new Map(ACTIONS.map((a) => [a.id, a]))
