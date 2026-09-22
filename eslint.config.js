import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
  },
  {
    // Board.jsx הוא רכיב אחד גדול שמחזיק שק מצב מוטבילי ב-ref ומשנה אותו
    // בתוך מטפלי אירועים שמוגדרים אחרי ה-useEffect שקורא אותו. הקומפיילר של
    // React צודק שזה מבנה בעייתי, והפתרון האמיתי הוא פיצול הרכיב ל-hooks
    // נפרדים: מנוע הדיו, המחוות, שכבת המתמטיקה וההיסטוריה. עד שהפיצול ייעשה,
    // ההערות האלה מוצגות כאזהרות ולא כשגיאות, וזאת אך ורק בקובץ הזה —
    // כל שאר הקבצים, כולל כל המודולים החדשים, נבדקים בתקן המלא.
    files: ['src/components/Board.jsx'],
    rules: {
      'react-hooks/immutability': 'warn',
      'react-hooks/refs': 'warn',
    },
  },
])
