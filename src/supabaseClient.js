import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    "متغيرات البيئة VITE_SUPABASE_URL و VITE_SUPABASE_ANON_KEY لازم تكون متظبطة في ملف .env — راجع .env.example"
  );
}

// storageKey مميز عشان الجلسة دي متتلخبطش مع تطبيقي الإدارة وولي الأمر
// (الثلاثة بيتشاركوا نفس الـ Domain على GitHub Pages)
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
    storageKey: "bybus-supervisor-auth",
  },
});
