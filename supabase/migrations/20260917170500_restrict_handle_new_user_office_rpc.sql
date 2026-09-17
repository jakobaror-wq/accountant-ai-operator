-- מונע קריאה ישירה ל-RPC הזה מבחוץ (הוא מיועד רק כ-Trigger פנימי, לא API ציבורי)
revoke execute on function public.handle_new_user_office() from public, anon, authenticated;
