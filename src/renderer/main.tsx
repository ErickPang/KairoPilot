import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import './index.css'
import { I18nProvider } from './components/layout/I18nProvider'
import { installWorkbenchPreview } from './workbenchPreview'

if (import.meta.env.DEV && !window.kairo) installWorkbenchPreview()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {window.kairo ? (
      <I18nProvider>
        <App />
      </I18nProvider>
    ) : (
      <main role="alert" style={{ padding: 48, fontFamily: 'system-ui', lineHeight: 1.8 }}>
        <h1>KairoPilot 无法连接本地服务</h1>
        <p>本地桥接加载失败，请重启应用。若问题持续，请检查安装文件是否完整。</p>
        <p>The local bridge failed to load. Restart the app or check the installation.</p>
      </main>
    )}
  </React.StrictMode>,
)
