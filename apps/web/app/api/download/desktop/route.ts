import { NextResponse } from "next/server";

/**
 * במקום להצביע על קובץ ספציפי (ששמו/גרסתו משתנים בכל build, וגם GitHub
 * מסנן רווחים משמות asset - זו הייתה הסיבה ל-404 הקודם), שולפים כאן את
 * ה-Release העדכני בזמן אמת ומפנים ל-asset ה-.exe שבו. כך הקישור לעולם לא
 * נשבר, גם כשה-CI (build-desktop.yml) מפרסם build חדש.
 *
 * ה-fetch עצמו כן מתעדכן אוטומטית (revalidate) כל כמה דקות במקום no-store -
 * אין שום צורך בטריות מוחלטת בכל קליק בודד, רק שזה לעולם לא יישאר תקוע-לצמיתות
 * על גרסה ישנה. עדיין תמיד שם הקובץ האמיתי מה-API, לא קובץ מקודד קשיח.
 */
const LATEST_RELEASE_API_URL =
  "https://api.github.com/repos/jakobaror-wq/accountant-ai-operator/releases/latest";

export const revalidate = 300;

export async function GET() {
  const res = await fetch(LATEST_RELEASE_API_URL, {
    headers: { Accept: "application/vnd.github+json", "User-Agent": "accountant-ai-operator" },
    next: { revalidate: 300 },
  });

  if (!res.ok) {
    return NextResponse.json({ error: "לא ניתן לשלוף את גרסת ההתקנה העדכנית" }, { status: 502 });
  }

  const release = (await res.json()) as { assets?: { name: string; browser_download_url: string }[] };
  const exeAsset = release.assets?.find((asset) => asset.name.endsWith(".exe"));

  if (!exeAsset) {
    return NextResponse.json({ error: "לא נמצא קובץ התקנה בגרסה העדכנית" }, { status: 404 });
  }

  return NextResponse.redirect(exeAsset.browser_download_url);
}
