import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { SettingsProvider } from './settings/SettingsContext'
import { ThemeProvider } from './theme/ThemeContext'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SettingsProvider>
      <ThemeProvider>
        <App />
      </ThemeProvider>
    </SettingsProvider>
  </StrictMode>,
)
