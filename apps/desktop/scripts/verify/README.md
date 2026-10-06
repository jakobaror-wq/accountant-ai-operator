# סקריפטי אימות אד-הוק (verify-*.js)

אלה **לא** חלק מ-test runner מסודר (אין Jest/Mocha, אין CI שמריץ אותם
אוטומטית) - כל קובץ הוא תסריט עצמאי שנכתב תוך כדי תיקון/בניית פיצ'ר
ספציפי, בדרך כלל כדי לאמת טענה אחת-שתיים מאוד ממוקדות (למשל "ה-timeout
החדש ל-xAI באמת לא תוקע את הלולאה לצמיתות", לא "כל האפליקציה עובדת").
כל קובץ מתעד בתחילתו מה בדיוק הוא בודק ולמה.

## איך להריץ סקריפט בודד

```bash
cd apps/desktop
npm run build   # הסקריפטים דורשים dist/ מעודכן - הם לא בודקים את src/ ישירות
xvfb-run -a node_modules/.bin/electron --no-sandbox scripts/verify/<name>.js
```

(`xvfb-run` נדרש בסביבת Linux ללא display אמיתי, כמו sandbox/CI; על
Windows/macOS עם display אמיתי אפשר להריץ בלי `xvfb-run -a`.)

כל סקריפט מדפיס `PASS`/`FAIL` לכל בדיקה ומסיים ב-JSON עם `"allOk"` -
`true`/`false` - ו-exit code תואם (0 אם הכל עבר, 1 אם לא).

## מגבלות ידועות

- **כמה סקריפטים לוקחים זמן אמיתי** (לא מדומה) - בעיקר `verify-agent-visibility.js`
  (שני timeouts אמיתיים של ~45 שניות) ו-`verify-window-focus.js` (timeout
  אמיתי של ~30 שניות) - אל תניחו שתסריט "תקוע" אם אין פלט למשך דקה-שתיים.
- **`verify-window-reload-live.js`/`verify-crash-fix-loadurl.js`** בודקים
  תזמון-retry מול Chromium אמיתי (`loadURL` על כתובת שלא מאזינה אף אחד) -
  ידועים כ"רועשים" (flaky) בסביבות sandbox עם GPU מוחלש (נצפה גם בסביבת
  הפיתוח של הסשן הזה) - אם בדיקת-התזמון המדויקת נכשלת אבל "process
  survived"/"no unhandled rejection" כן עברו, זו כנראה רעש-סביבה, לא
  רגרסיה אמיתית.
- **`verify-crash-fix-loadurl-BROKEN.js` נשאר מחוץ ל-repo במכוון** (לא
  הועתק לכאן) - הוא מדגים את ה**באג הישן** (לפני התיקון), לא בדיקת-
  רגרסיה; שמירתו רק כהדגמה למי שרוצה להבין את התיקון ב-`window-reload.ts`.
- חלק מהסקריפטים דורסים (monkey-patch) פונקציות מודולים אמיתיים
  (`computer-use.captureScreenshot`, `grok.requestNextAction` וכו') כדי
  למקד את הבדיקה בלי תלות ברשת/חומרה אמיתית - זה תקין ומכוון, לא תקלה.
