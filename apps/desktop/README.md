# Accountant AI Operator - Desktop Companion

חלון שולחן-עבודה קטן (Electron) שטוען בתוכו את אותו אתר שרץ ב-Vercel, ומוסיף לו שתי יכולות
מקומיות דרך `contextBridge` (`window.electronAPI`):

- `pickExecutable(connectorId)` - פותח דיאלוג בחירת קובץ מקומי (native, לא HTML), שומר את הנתיב
  שנבחר בקובץ JSON מקומי בתיקיית ה-userData של האפליקציה.
- `launchExecutable(connectorId)` - מפעיל את הקובץ שנשמר לאותו connectorId דרך `shell.openPath`.

שום נתיב קובץ לא נשלח לענן - השמירה מקומית בלבד (`app.getPath("userData")/connector-paths.json`).

## הרצה מקומית (פיתוח)

```bash
npm install
AIOP_WEB_URL=http://localhost:3100 npm start
```

## בנייה

```bash
npm run dist:win     # NSIS installer ל-Windows (עם קיצור דרך לשולחן העבודה)
npm run dist:linux   # AppImage, לבדיקה מקומית בלבד
```

בנייה ל-Windows דורשת בפועל Windows runner (ר' `.github/workflows/build-desktop.yml`
שמריץ את זה אוטומטית ב-GitHub Actions ומפרסם Release עם קובץ ה-.exe).

## אייקון

`build/icon-source.svg` הוא המקור; `build/icon.png` ו-`build/icon.ico` נוצרו ממנו (Sharp +
png-to-ico). לשינוי הלוגו - עורכים את ה-SVG ומריצים מחדש את סקריפט ההמרה (ר' היסטוריית ה-commit
שיצר את הקבצים לרפרנס לפקודה המדויקת).
