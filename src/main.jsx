import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import { MathfieldElement } from 'mathlive'
import './index.css'
import App from './App.jsx'

// הפונטים של MathLive מוגשים מתוך האפליקציה, ולא מ-CDN. בלי זה המקלדת
// המתמטית נשברת במצב אופליין, בדיוק כשאין רשת ואי אפשר להוריד כלום.
MathfieldElement.fontsDirectory = '/mathlive/fonts'
// צלילי ההקלדה היו מגיעים גם הם מהרשת. אין בהם צורך, וכיבוים חוסך הורדה.
MathfieldElement.soundsDirectory = null

// מפעיל עדכון אוטומטי של האפליקציה ברקע
registerSW({ immediate: true })

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
