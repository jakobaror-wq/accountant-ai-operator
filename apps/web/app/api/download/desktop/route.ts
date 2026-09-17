import { NextResponse } from "next/server";

/**
 * הכתובת הציבורית הקבועה של קובץ ההתקנה ב-Supabase Storage. ה-CI (ר.
 * .github/workflows/build-desktop.yml) מעלה את ה-build העדכני לאותו נתיב
 * בדיוק בכל push, כך שהקישור הזה תמיד מצביע על הגרסה האחרונה.
 */
const LATEST_INSTALLER_URL =
  "https://sngjrtuhpuclkbalduzs.supabase.co/storage/v1/object/public/desktop-app/latest/AccountantAIOperatorSetup.exe";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.redirect(LATEST_INSTALLER_URL);
}
