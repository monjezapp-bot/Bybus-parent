import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  Bus, Users, MessageCircle, School, LogOut, Home, Star, Receipt,
  Eye, EyeOff, CheckCircle2, RefreshCw, Loader2, AlertCircle, User,
  Send, ChevronLeft, ChevronRight, Camera, PhoneCall,
} from "lucide-react";
import { MapContainer, TileLayer, Marker, useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { supabase } from "./supabaseClient";

/*
  Bybus — تطبيق ولي الأمر
  =========================
  متصل مباشرة بنفس قاعدة بيانات Bybus على Supabase (نفس المشروع بتاع لوحة تحكم
  الإدارة). ولي الأمر بيسجل حساب لنفسه (خلاف المشرفة والإدارة)، وبيشوف بيانات
  أبنائه وحالتهم اللحظية بس - مفيش أي تعديل لبيانات الطفل أو الباص، ده بيتم من
  لوحة الإدارة فقط.
*/

const COLORS = {
  sun: "#FFC93C",
  sky: "#4FB6E8",
  mint: "#4ECDC4",
  orange: "#FF8C42",
  danger: "#EF4444",
};

const SUBSCRIPTION_STATUS_LABELS = {
  active: { label: "نشط", color: COLORS.mint },
  expired: { label: "منتهي", color: COLORS.orange },
  cancelled: { label: "ملغي", color: "#9CA3AF" },
  pending: { label: "بانتظار أول دفعة", color: COLORS.sun },
};

function todayStr() {
  return new Date().toLocaleDateString("en-CA");
}

function BybusMark({ size = 40 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none">
      <rect x="4" y="16" width="56" height="34" rx="14" fill={COLORS.sky} />
      <rect x="10" y="22" width="14" height="12" rx="4" fill="white" />
      <rect x="28" y="22" width="14" height="12" rx="4" fill="white" />
      <circle cx="18" cy="52" r="6" fill="#2D3436" />
      <circle cx="46" cy="52" r="6" fill="#2D3436" />
      <path d="M14 40 Q 20 46 26 40" stroke="#2D3436" strokeWidth="2.5" strokeLinecap="round" fill="none" />
      <circle cx="15" cy="30" r="2" fill="#2D3436" />
      <circle cx="35" cy="30" r="2" fill="#2D3436" />
      <rect x="46" y="24" width="10" height="16" rx="4" fill={COLORS.sun} />
    </svg>
  );
}

/* ================= حالة الطفل اللحظية ================= */

function getChildStatus(morningTrip, morningTS, eveningTrip, eveningTS) {
  // غايب اليوم (اتسجل غياب مسبق أو أثناء اليوم)
  if (morningTS?.status === "absent" && (!eveningTrip || eveningTS?.status !== "boarded")) {
    return { label: "غائب اليوم", color: "#9CA3AF", icon: "home" };
  }
  // رجع البيت فعلاً (رحلة العودة خلصت أو الطفل نزل منها)
  if (eveningTS?.status === "dropped_off" || eveningTrip?.status === "completed") {
    return { label: "وصل المنزل", color: COLORS.mint, icon: "home" };
  }
  // في الباص - في طريق العودة
  if (eveningTrip?.status === "active" && eveningTS?.status === "boarded") {
    return { label: "في الباص - في الطريق للمنزل", color: COLORS.sky, icon: "bus" };
  }
  // في المدرسة (نزل من رحلة الذهاب ولسه العودة ما بدأتش)
  if (morningTS?.status === "dropped_off" || morningTrip?.status === "completed") {
    return { label: "في المدرسة", color: COLORS.sun, icon: "school" };
  }
  // في الباص - في طريق المدرسة
  if (morningTrip?.status === "active" && morningTS?.status === "boarded") {
    return { label: "في الباص - في الطريق للمدرسة", color: COLORS.sky, icon: "bus" };
  }
  // لسه في المنزل (الافتراضي قبل ما أي رحلة تبدأ)
  return { label: "في المنزل", color: "#9CA3AF", icon: "home" };
}

function StatusIcon({ icon, color, size = 18 }) {
  if (icon === "bus") return <Bus size={size} color={color} />;
  if (icon === "school") return <School size={size} color={color} />;
  return <Home size={size} color={color} />;
}

/* ================= شاشة الدخول / التسجيل ================= */

function AuthScreen() {
  const [mode, setMode] = useState("login"); // login | signup
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");

  async function handleLogin(e) {
    e.preventDefault();
    setError("");
    if (!email || !password) {
      setError("من فضلك أدخل البريد الإلكتروني وكلمة المرور");
      return;
    }
    setLoading(true);
    try {
      const { data: authData, error: authError } = await supabase.auth.signInWithPassword({ email, password });
      if (authError) throw new Error("البريد الإلكتروني أو كلمة المرور غير صحيحة");

      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("id, role")
        .eq("id", authData.user.id)
        .single();

      if (profileError || !profile || profile.role !== "parent") {
        await supabase.auth.signOut();
        throw new Error("هذا الحساب مش حساب ولي أمر");
      }
      // باقي الشغل هيتم أوتوماتيك عن طريق onAuthStateChange في App
    } catch (err) {
      setError(err.message);
      setLoading(false);
    }
  }

  async function handleSignup(e) {
    e.preventDefault();
    setError("");
    setInfo("");
    if (!fullName || !email || !password) {
      setError("لازم تملأ الاسم والبريد الإلكتروني وكلمة المرور على الأقل");
      return;
    }
    if (password.length < 6) {
      setError("كلمة المرور لازم تكون 6 حروف/أرقام على الأقل");
      return;
    }
    setLoading(true);
    try {
      const { data, error: signUpError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            signup_role: "parent",
            full_name: fullName,
            phone: phone || null,
          },
        },
      });
      if (signUpError) throw new Error(signUpError.message);

      if (data.session) {
        // تسجيل الدخول تلقائياً بعد التسجيل مباشرة (لو التأكيد بالبريد مش مفعّل)
        return;
      }
      setInfo("تم إنشاء الحساب بنجاح! لو مطلوب تأكيد البريد الإلكتروني، هتلاقي رسالة في بريدك لازم تأكدها الأول قبل الدخول.");
      setMode("login");
    } catch (err) {
      setError(err.message || "حصل خطأ غير متوقع أثناء إنشاء الحساب");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-gray-50 px-4 py-8" dir="rtl">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-6">
          <div className="rounded-3xl p-4 mb-3" style={{ backgroundColor: "#EAF6FC" }}>
            <BybusMark size={56} />
          </div>
          <h1 className="text-2xl font-bold text-gray-800">Bybus</h1>
          <p className="text-gray-400 text-sm mt-1">تطبيق ولي الأمر</p>
        </div>

        <div className="flex bg-gray-100 rounded-2xl p-1 mb-5">
          <button
            onClick={() => { setMode("login"); setError(""); setInfo(""); }}
            className="flex-1 rounded-xl py-2.5 text-sm font-bold transition-colors"
            style={mode === "login" ? { backgroundColor: "white", color: COLORS.sky, boxShadow: "0 1px 3px rgba(0,0,0,0.08)" } : { color: "#9CA3AF" }}
          >
            تسجيل الدخول
          </button>
          <button
            onClick={() => { setMode("signup"); setError(""); setInfo(""); }}
            className="flex-1 rounded-xl py-2.5 text-sm font-bold transition-colors"
            style={mode === "signup" ? { backgroundColor: "white", color: COLORS.sky, boxShadow: "0 1px 3px rgba(0,0,0,0.08)" } : { color: "#9CA3AF" }}
          >
            حساب جديد
          </button>
        </div>

        <form onSubmit={mode === "login" ? handleLogin : handleSignup} className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
          {error && (
            <div className="flex items-start gap-2 bg-red-50 border border-red-100 text-red-600 text-xs rounded-xl p-3 mb-4">
              <AlertCircle size={16} className="shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}
          {info && (
            <div className="flex items-start gap-2 bg-sky-50 border border-sky-100 text-sky-700 text-xs rounded-xl p-3 mb-4">
              <CheckCircle2 size={16} className="shrink-0 mt-0.5" />
              <span>{info}</span>
            </div>
          )}

          {mode === "signup" && (
            <>
              <label className="block text-sm font-medium text-gray-600 mb-1.5">الاسم بالكامل</label>
              <input
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="اسمك بالكامل"
                className="w-full rounded-xl border border-gray-200 px-4 py-2.5 mb-4 text-sm focus:outline-none focus:ring-2 focus:ring-sky-300"
              />
              <label className="block text-sm font-medium text-gray-600 mb-1.5">رقم التليفون</label>
              <input
                dir="ltr"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="01xxxxxxxxx"
                className="w-full rounded-xl border border-gray-200 px-4 py-2.5 mb-4 text-sm text-left focus:outline-none focus:ring-2 focus:ring-sky-300"
              />
            </>
          )}

          <label className="block text-sm font-medium text-gray-600 mb-1.5">البريد الإلكتروني</label>
          <input
            type="email"
            dir="ltr"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="example@email.com"
            className="w-full rounded-xl border border-gray-200 px-4 py-2.5 mb-4 text-sm text-left focus:outline-none focus:ring-2 focus:ring-sky-300"
          />

          <label className="block text-sm font-medium text-gray-600 mb-1.5">كلمة المرور</label>
          <div className="relative mb-6">
            <input
              type={showPw ? "text" : "password"}
              dir="ltr"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm text-left focus:outline-none focus:ring-2 focus:ring-sky-300"
            />
            <button type="button" onClick={() => setShowPw(!showPw)} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
              {showPw ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-xl py-3 text-white font-semibold text-sm transition-transform active:scale-[0.98] flex items-center justify-center gap-2 disabled:opacity-70"
            style={{ backgroundColor: COLORS.orange }}
          >
            {loading && <Loader2 size={16} className="animate-spin" />}
            {loading ? "جارٍ التحميل..." : mode === "login" ? "تسجيل الدخول" : "إنشاء حساب"}
          </button>
        </form>

        <p className="text-center text-xs text-gray-400 mt-6">
          بيانات المشرفة والسائق والباص تُسجَّل من الإدارة فقط — الحساب ده لولي الأمر بس
        </p>
      </div>
    </div>
  );
}

/* ================= خريطة عرض موقع الباص اللحظي (قراءة فقط) ================= */

const busPinIcon = new L.DivIcon({
  html: '<div style="font-size:26px;line-height:26px;filter:drop-shadow(0 2px 2px rgba(0,0,0,0.3))">🚌</div>',
  className: "",
  iconSize: [26, 26],
  iconAnchor: [13, 13],
});

const homePinIcon = new L.DivIcon({
  html: '<div style="font-size:26px;line-height:26px;filter:drop-shadow(0 2px 2px rgba(0,0,0,0.3))">📍</div>',
  className: "",
  iconSize: [26, 26],
  iconAnchor: [13, 26],
});

function MapAutoCenter({ lat, lng }) {
  const map = useMap();
  useEffect(() => {
    if (lat != null && lng != null) map.setView([lat, lng], Math.max(map.getZoom(), 14));
  }, [lat, lng]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

function LiveBusMap({ lat, lng, height = 160 }) {
  if (lat == null || lng == null) return null;
  return (
    <div className="rounded-xl overflow-hidden border border-gray-100" style={{ height }}>
      <MapContainer center={[lat, lng]} zoom={15} style={{ height: "100%", width: "100%" }} zoomControl={false} dragging={true} scrollWheelZoom={false}>
        <TileLayer attribution="&copy; OpenStreetMap" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
        <Marker position={[lat, lng]} icon={busPinIcon} />
        <MapAutoCenter lat={lat} lng={lng} />
      </MapContainer>
    </div>
  );
}

function MapClickHandler({ onPick }) {
  useMapEvents({
    click(e) {
      onPick(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

function LocationPicker({ lat, lng, onChange }) {
  const [linkInput, setLinkInput] = useState("");
  const [linkError, setLinkError] = useState("");
  const cairoCenter = [30.0444, 31.2357];

  function handleLinkSubmit() {
    setLinkError("");
    if (!linkInput.trim()) return;
    const patterns = [/@(-?\d+\.\d+),(-?\d+\.\d+)/, /[?&]q=(-?\d+\.\d+),(-?\d+\.\d+)/, /[?&]ll=(-?\d+\.\d+),(-?\d+\.\d+)/];
    for (const p of patterns) {
      const m = linkInput.match(p);
      if (m) {
        onChange(parseFloat(m[1]), parseFloat(m[2]));
        setLinkInput("");
        return;
      }
    }
    setLinkError("مقدرتش أفهم اللينك ده. جرب تدوس على المكان في الخريطة مباشرة بدل كده");
  }

  return (
    <div>
      <div className="flex gap-2 mb-2">
        <input
          dir="ltr"
          placeholder="أو الصق رابط Google Maps هنا"
          value={linkInput}
          onChange={(e) => setLinkInput(e.target.value)}
          className="flex-1 rounded-xl border border-gray-200 px-3 py-2 text-xs text-left focus:outline-none focus:ring-2 focus:ring-sky-300"
        />
        <button type="button" onClick={handleLinkSubmit} className="rounded-xl px-3 text-xs font-bold text-white shrink-0" style={{ backgroundColor: COLORS.sky }}>
          تحديد
        </button>
      </div>
      {linkError && <div className="text-[11px] text-red-500 mb-2">{linkError}</div>}
      <div className="rounded-xl overflow-hidden border border-gray-200" style={{ height: 200 }}>
        <MapContainer center={lat != null && lng != null ? [lat, lng] : cairoCenter} zoom={lat != null && lng != null ? 15 : 6} style={{ height: "100%", width: "100%" }}>
          <TileLayer attribution="&copy; OpenStreetMap" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
          <MapClickHandler onPick={onChange} />
          {lat != null && lng != null && <Marker position={[lat, lng]} icon={homePinIcon} />}
          <MapAutoCenter lat={lat} lng={lng} />
        </MapContainer>
      </div>
      <div className="text-[11px] text-gray-400 mt-1.5">
        {lat != null && lng != null ? `الموقع المحدد: ${lat.toFixed(5)}, ${lng.toFixed(5)}` : "دوس على المكان بالظبط في الخريطة لتحديد موقع المنزل"}
      </div>
    </div>
  );
}

/* ================= عناصر مشتركة ================= */

function TopBar({ title, subtitle, right }) {
  return (
    <div className="flex items-center justify-between px-4 pt-5 pb-3">
      <div>
        <h1 className="text-lg font-bold text-gray-800">{title}</h1>
        {subtitle && <p className="text-xs text-gray-400 mt-0.5">{subtitle}</p>}
      </div>
      {right}
    </div>
  );
}

function ErrorBanner({ message }) {
  if (!message) return null;
  return (
    <div className="mx-4 flex items-start gap-2 bg-red-50 border border-red-100 text-red-600 text-xs rounded-xl p-3 mb-3">
      <AlertCircle size={16} className="shrink-0 mt-0.5" />
      <span>{message}</span>
    </div>
  );
}

function Spinner() {
  return (
    <div className="flex items-center justify-center py-10 text-gray-300">
      <Loader2 size={22} className="animate-spin" />
    </div>
  );
}

/* ================= الصفحة الرئيسية ================= */

function ChildCard({ child, onOpenChat, onRate }) {
  const status = getChildStatus(child.morningTrip, child.morningTS, child.eveningTrip, child.eveningTS);
  const activeTrip = child.morningTrip?.status === "active" ? child.morningTrip : child.eveningTrip?.status === "active" ? child.eveningTrip : null;
  const canReportAbsence =
    child.morningTrip?.status === "scheduled" && child.morningTS && child.morningTS.status !== "absent";

  const [reporting, setReporting] = useState(false);
  const [reportError, setReportError] = useState("");
  const [reported, setReported] = useState(false);

  async function reportAbsence() {
    setReporting(true);
    setReportError("");
    try {
      const { error } = await supabase
        .from("trip_students")
        .update({ status: "absent", absence_type: "advance_notice" })
        .eq("id", child.morningTS.id);
      if (error) throw error;
      setReported(true);
    } catch (err) {
      setReportError(err.message);
    } finally {
      setReporting(false);
    }
  }

  return (
    <div className="bg-white rounded-2xl border border-gray-100 p-4 mb-3">
      <div className="flex items-center gap-3">
        <div className="w-11 h-11 rounded-full flex items-center justify-center font-bold text-white text-sm shrink-0" style={{ backgroundColor: COLORS.sun }}>
          {child.full_name?.trim().slice(0, 2) || "؟"}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-bold text-gray-800 truncate">{child.full_name}{child.grade ? ` · ${child.grade}` : ""}</div>
          <div className="text-xs text-gray-400 truncate">
            {child.schools?.name || "بدون مدرسة"}{child.buses?.bus_code ? ` · ${child.buses.bus_code}` : " · بدون باص"}
          </div>
        </div>
        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full shrink-0" style={{ backgroundColor: status.color + "20" }}>
          <StatusIcon icon={status.icon} color={status.color} size={13} />
          <span className="text-[11px] font-bold" style={{ color: status.color }}>{status.label}</span>
        </div>
      </div>

      {activeTrip && (
        <div className="mt-3">
          <LiveBusMap lat={activeTrip.current_lat} lng={activeTrip.current_lng} />
          {!activeTrip.current_lat && (
            <div className="text-[11px] text-gray-400 text-center py-3">الرحلة بدأت، وهيظهر موقع الباص هنا أول ما يتحدث GPS</div>
          )}
        </div>
      )}

      {(child.latestPhoto) && (
        <div className="mt-3 flex items-center gap-2 text-[11px] text-gray-500 bg-gray-50 rounded-xl p-2.5">
          <Camera size={14} className="text-gray-400 shrink-0" />
          <span>آخر توثيق: {new Date(child.latestPhoto).toLocaleTimeString("ar-EG", { hour: "2-digit", minute: "2-digit" })}</span>
        </div>
      )}

      {reportError && <div className="text-[11px] text-red-500 mt-2">{reportError}</div>}

      <div className="flex gap-2 mt-3">
        {canReportAbsence && !reported && (
          <button
            onClick={reportAbsence}
            disabled={reporting}
            className="flex-1 rounded-xl py-2 text-xs font-bold border border-gray-200 text-gray-500 hover:bg-gray-50 flex items-center justify-center gap-1.5 disabled:opacity-60"
          >
            {reporting && <Loader2 size={12} className="animate-spin" />}
            الإبلاغ عن غياب اليوم
          </button>
        )}
        {reported && (
          <div className="flex-1 rounded-xl py-2 text-xs font-bold text-center" style={{ backgroundColor: COLORS.mint + "20", color: COLORS.mint }}>
            تم تسجيل الغياب ✓
          </div>
        )}
        {child.buses?.id && (
          <button
            onClick={() => onOpenChat(child)}
            className="rounded-xl px-3 py-2 text-xs font-bold text-white flex items-center gap-1.5"
            style={{ backgroundColor: COLORS.sky }}
          >
            <MessageCircle size={13} /> المشرفة
          </button>
        )}
        {child.buses?.id && (
          <button
            onClick={() => onRate(child)}
            className="rounded-xl px-3 py-2 text-xs font-bold border border-gray-200 text-gray-500 flex items-center gap-1.5"
          >
            <Star size={13} /> تقييم
          </button>
        )}
      </div>
    </div>
  );
}

function RateBusModal({ child, onClose, onSaved }) {
  const [stars, setStars] = useState(5);
  const [comment, setComment] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      const { data: userData } = await supabase.auth.getUser();
      const { error: insertError } = await supabase.from("ratings").insert({
        parent_id: userData.user.id,
        bus_id: child.buses.id,
        stars,
        comment: comment.trim() || null,
      });
      if (insertError) throw insertError;
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/30 flex items-end sm:items-center justify-center z-50 p-4" dir="rtl">
      <div className="bg-white rounded-2xl w-full max-w-sm p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold text-gray-800 text-base">تقييم باص {child.buses?.bus_code}</h3>
          <button onClick={onClose} className="text-gray-400 text-xl leading-none px-2">×</button>
        </div>

        {error && <ErrorBanner message={error} />}

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex items-center justify-center gap-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <button type="button" key={i} onClick={() => setStars(i + 1)}>
                <Star size={30} color={i < stars ? COLORS.sun : "#E5E7EB"} fill={i < stars ? COLORS.sun : "none"} />
              </button>
            ))}
          </div>
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="تعليق (اختياري)"
            rows={3}
            className="w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-sky-300"
          />
          <button
            type="submit"
            disabled={saving}
            className="w-full rounded-xl py-3 text-white font-semibold text-sm flex items-center justify-center gap-2 disabled:opacity-70"
            style={{ backgroundColor: COLORS.orange }}
          >
            {saving && <Loader2 size={16} className="animate-spin" />}
            {saving ? "جارٍ الإرسال..." : "إرسال التقييم"}
          </button>
        </form>
      </div>
    </div>
  );
}

function HomePage({ profile, onOpenChatWithBus }) {
  const [children, setChildren] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [ratingChild, setRatingChild] = useState(null);

  const loadData = useCallback(async (isRefresh = false) => {
    isRefresh ? setRefreshing(true) : setLoading(true);
    setError("");
    try {
      const today = todayStr();

      const { data: students, error: studentsError } = await supabase
        .from("students")
        .select("id, full_name, grade, bus_id, schools(name), buses(id, bus_code, profiles(full_name))")
        .order("full_name", { ascending: true });
      if (studentsError) throw studentsError;

      const busIds = [...new Set((students || []).map((s) => s.bus_id).filter(Boolean))];
      const studentIds = (students || []).map((s) => s.id);

      let trips = [];
      let tripStudents = [];

      if (busIds.length > 0) {
        const { data: tripsData, error: tripsError } = await supabase
          .from("trips")
          .select("id, bus_id, trip_type, status, current_lat, current_lng")
          .in("bus_id", busIds)
          .eq("trip_date", today);
        if (tripsError) throw tripsError;
        trips = tripsData || [];
      }

      if (studentIds.length > 0 && trips.length > 0) {
        const { data: tsData, error: tsError } = await supabase
          .from("trip_students")
          .select("id, trip_id, student_id, status, absence_type, photo_url, checked_at")
          .in("student_id", studentIds)
          .in("trip_id", trips.map((t) => t.id));
        if (tsError) throw tsError;
        tripStudents = tsData || [];
      }

      const enriched = (students || []).map((s) => {
        const morningTrip = trips.find((t) => t.bus_id === s.bus_id && t.trip_type === "morning") || null;
        const eveningTrip = trips.find((t) => t.bus_id === s.bus_id && t.trip_type === "evening") || null;
        const morningTS = morningTrip ? tripStudents.find((ts) => ts.trip_id === morningTrip.id && ts.student_id === s.id) : null;
        const eveningTS = eveningTrip ? tripStudents.find((ts) => ts.trip_id === eveningTrip.id && ts.student_id === s.id) : null;
        const photos = [morningTS?.photo_url && morningTS.checked_at, eveningTS?.photo_url && eveningTS.checked_at].filter(Boolean);
        const latestPhoto = photos.length ? photos.sort().reverse()[0] : null;
        return { ...s, morningTrip, eveningTrip, morningTS, eveningTS, latestPhoto };
      });

      setChildren(enriched);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadData();
    const channel = supabase
      .channel("parent-home-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "trips" }, () => loadData(true))
      .on("postgres_changes", { event: "*", schema: "public", table: "trip_students" }, () => loadData(true))
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [loadData]);

  return (
    <div className="pb-4">
      <TopBar
        title={`أهلاً، ${profile.full_name?.split(" ")[0] || ""}`}
        subtitle={new Date().toLocaleDateString("ar-EG", { weekday: "long", day: "numeric", month: "long" })}
        right={
          <button onClick={() => loadData(true)} disabled={refreshing} className="rounded-xl border border-gray-200 p-2 text-gray-500 disabled:opacity-50">
            <RefreshCw size={16} className={refreshing ? "animate-spin" : ""} />
          </button>
        }
      />

      <ErrorBanner message={error} />

      <div className="px-4">
        {loading ? (
          <Spinner />
        ) : children.length === 0 ? (
          <div className="text-center py-14 text-sm text-gray-400 bg-white rounded-2xl border border-gray-100">
            لسه مفيش أبناء مسجّلين على حسابك — تواصل مع إدارة Bybus لتسجيل بياناتهم
          </div>
        ) : (
          children.map((child) => (
            <ChildCard
              key={child.id}
              child={child}
              onOpenChat={(c) => onOpenChatWithBus(c.buses)}
              onRate={(c) => setRatingChild(c)}
            />
          ))
        )}
      </div>

      {ratingChild && (
        <RateBusModal
          child={ratingChild}
          onClose={() => setRatingChild(null)}
          onSaved={() => setRatingChild(null)}
        />
      )}
    </div>
  );
}

/* ================= صفحة الأبناء (تفاصيل) ================= */

function ChildDetailModal({ child, onClose, onSaved }) {
  const [detail, setDetail] = useState(null);
  const [form, setForm] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError("");
      try {
        const { data, error: fetchError } = await supabase
          .from("students")
          .select(
            "id, full_name, grade, home_lat, home_lng, home_address_text, schools(name, address_text, phone, whatsapp_number), buses(id, bus_code, plate_number, vehicle_model, profiles(full_name, phone))"
          )
          .eq("id", child.id)
          .single();
        if (fetchError) throw fetchError;
        setDetail(data);
        setForm({
          full_name: data.full_name || "",
          grade: data.grade || "",
          home_address_text: data.home_address_text || "",
          home_lat: data.home_lat,
          home_lng: data.home_lng,
        });
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [child.id]);

  function update(field, value) {
    setForm((p) => ({ ...p, [field]: value }));
    setSaved(false);
  }

  async function handleSave(e) {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      const { error: updateError } = await supabase
        .from("students")
        .update({
          full_name: form.full_name,
          grade: form.grade || null,
          home_address_text: form.home_address_text || null,
          home_lat: form.home_lat ?? null,
          home_lng: form.home_lng ?? null,
        })
        .eq("id", child.id);
      if (updateError) throw updateError;
      setSaved(true);
      onSaved?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  const inputClass = "w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-sky-300";
  const labelClass = "block text-xs font-medium text-gray-500 mb-1.5";

  return (
    <div className="fixed inset-0 bg-black/30 flex items-end sm:items-center justify-center z-50" dir="rtl">
      <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md max-h-[85vh] overflow-auto p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold text-gray-800 text-base">{loading ? "جارٍ التحميل..." : detail?.full_name}</h3>
          <button onClick={onClose} className="text-gray-400 text-xl leading-none px-2">×</button>
        </div>

        {error && <ErrorBanner message={error} />}
        {saved && (
          <div className="flex items-center gap-2 bg-green-50 border border-green-100 text-green-600 text-xs rounded-xl p-3 mb-3">
            <CheckCircle2 size={16} className="shrink-0" /> تم حفظ بيانات {form.full_name}
          </div>
        )}

        {loading ? (
          <Spinner />
        ) : (
          <form onSubmit={handleSave} className="flex flex-col gap-4">
            <div>
              <label className={labelClass}>اسم الطالب</label>
              <input className={inputClass} value={form.full_name} onChange={(e) => update("full_name", e.target.value)} />
            </div>
            <div>
              <label className={labelClass}>الصف الدراسي</label>
              <input className={inputClass} value={form.grade} onChange={(e) => update("grade", e.target.value)} />
            </div>

            <div className="rounded-xl bg-gray-50 border border-gray-100 p-3 text-xs text-gray-500 flex flex-col gap-1">
              <div>المدرسة: {detail.schools?.name || "—"}</div>
              {detail.schools?.phone && <div dir="ltr">تليفون المدرسة: {detail.schools.phone}</div>}
              {detail.buses ? (
                <div>الباص: {detail.buses.bus_code} · {detail.buses.plate_number} · المشرفة: {detail.buses.profiles?.full_name || "—"}</div>
              ) : (
                <div>لسه ماتحددش باص للطالب ده</div>
              )}
              <div className="text-[10px] text-gray-400 mt-1">تغيير المدرسة أو الباص من صلاحية الإدارة فقط.</div>
            </div>

            <div>
              <label className={labelClass}>عنوان المنزل (نص وصفي)</label>
              <input className={inputClass} value={form.home_address_text} onChange={(e) => update("home_address_text", e.target.value)} />
            </div>

            <div>
              <label className={labelClass}>موقع المنزل على الخريطة</label>
              <LocationPicker
                lat={form.home_lat}
                lng={form.home_lng}
                onChange={(newLat, newLng) => setForm((p) => ({ ...p, home_lat: newLat, home_lng: newLng }))}
              />
            </div>

            <button
              type="submit"
              disabled={saving}
              className="w-full rounded-xl py-3 text-white font-semibold text-sm flex items-center justify-center gap-2 disabled:opacity-70"
              style={{ backgroundColor: COLORS.orange }}
            >
              {saving && <Loader2 size={16} className="animate-spin" />}
              {saving ? "جارٍ الحفظ..." : "حفظ التعديلات"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

function ChildrenPage() {
  const [children, setChildren] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState(null);

  const loadChildren = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const { data, error: fetchError } = await supabase
        .from("students")
        .select("id, full_name, grade, schools(name), buses(bus_code)")
        .order("full_name", { ascending: true });
      if (fetchError) throw fetchError;
      setChildren(data || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadChildren();
  }, [loadChildren]);

  return (
    <div className="pb-4">
      <TopBar title="أبنائي" subtitle={`${children.length} طفل مسجّل على حسابك`} />
      <ErrorBanner message={error} />
      <div className="px-4">
        {loading ? (
          <Spinner />
        ) : children.length === 0 ? (
          <div className="text-center py-14 text-sm text-gray-400 bg-white rounded-2xl border border-gray-100">
            لسه مفيش أبناء مسجّلين على حسابك
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {children.map((c) => (
              <button
                key={c.id}
                onClick={() => setSelected(c)}
                className="w-full text-right flex items-center gap-3 p-3.5 rounded-2xl bg-white border border-gray-100 hover:bg-gray-50"
              >
                <div className="w-11 h-11 rounded-full flex items-center justify-center font-bold text-white text-sm shrink-0" style={{ backgroundColor: COLORS.sun }}>
                  {c.full_name?.trim().slice(0, 2) || "؟"}
                </div>
                <div className="flex-1">
                  <div className="text-sm font-semibold text-gray-700">{c.full_name}{c.grade ? ` · ${c.grade}` : ""}</div>
                  <div className="text-xs text-gray-400">{c.schools?.name || "بدون مدرسة"}{c.buses?.bus_code ? ` · ${c.buses.bus_code}` : ""}</div>
                </div>
                <ChevronLeft size={18} className="text-gray-300 shrink-0" />
              </button>
            ))}
          </div>
        )}
      </div>

      {selected && <ChildDetailModal child={selected} onClose={() => setSelected(null)} onSaved={loadChildren} />}
    </div>
  );
}

/* ================= صفحة الدردشة ================= */

function ChatThread({ conversationId, profile, onBack }) {
  const [conversation, setConversation] = useState(null);
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [newMessage, setNewMessage] = useState("");
  const [sending, setSending] = useState(false);
  const bottomRef = useRef(null);

  const loadThread = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [convRes, msgsRes] = await Promise.all([
        supabase
          .from("conversations")
          .select("id, type, status, bus_id, participant_b_id, profiles!conversations_participant_b_id_fkey(full_name)")
          .eq("id", conversationId)
          .single(),
        supabase.from("messages").select("id, sender_id, content, created_at").eq("conversation_id", conversationId).order("created_at", { ascending: true }),
      ]);
      if (convRes.error) throw convRes.error;
      if (msgsRes.error) throw msgsRes.error;
      setConversation(convRes.data);
      setMessages(msgsRes.data || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [conversationId]);

  useEffect(() => {
    loadThread();
    const channel = supabase
      .channel(`chat-${conversationId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages", filter: `conversation_id=eq.${conversationId}` }, () => loadThread())
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [conversationId, loadThread]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  async function handleSend(e) {
    e.preventDefault();
    if (!newMessage.trim()) return;
    setSending(true);
    setError("");
    try {
      const { error: sendError } = await supabase.from("messages").insert({
        conversation_id: conversationId,
        sender_id: profile.id,
        content: newMessage.trim(),
      });
      if (sendError) throw sendError;
      setNewMessage("");
      loadThread();
    } catch (err) {
      setError(err.message);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex flex-col h-[calc(100vh-64px)]">
      <div className="p-4 border-b border-gray-100 flex items-center gap-2">
        <button onClick={onBack} className="text-gray-400"><ChevronRight size={20} /></button>
        <div className="font-semibold text-gray-700 text-sm">
          {conversation?.type === "support" ? "الدعم الفني" : conversation?.profiles?.full_name || "المشرفة"}
        </div>
      </div>

      <ErrorBanner message={error} />

      <div className="flex-1 overflow-auto p-4 flex flex-col gap-2">
        {loading ? (
          <Spinner />
        ) : messages.length === 0 ? (
          <div className="text-center text-xs text-gray-400 py-6">ابدأ المحادثة بإرسال أول رسالة</div>
        ) : (
          messages.map((m) => {
            const fromMe = m.sender_id === profile.id;
            return (
              <div
                key={m.id}
                className={`max-w-[75%] rounded-2xl px-3.5 py-2 text-sm ${fromMe ? "self-end text-white" : "self-start bg-gray-100 text-gray-700"}`}
                style={fromMe ? { backgroundColor: COLORS.sky } : {}}
              >
                {m.content}
                <div className={`text-[10px] mt-1 ${fromMe ? "text-white/70" : "text-gray-400"}`}>
                  {new Date(m.created_at).toLocaleTimeString("ar-EG", { hour: "2-digit", minute: "2-digit" })}
                </div>
              </div>
            );
          })
        )}
        <div ref={bottomRef} />
      </div>

      <form onSubmit={handleSend} className="p-4 border-t border-gray-100 flex gap-2">
        <input
          value={newMessage}
          onChange={(e) => setNewMessage(e.target.value)}
          placeholder="اكتب رسالتك..."
          className="flex-1 rounded-xl border border-gray-200 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-sky-300"
        />
        <button
          type="submit"
          disabled={sending || !newMessage.trim()}
          className="rounded-xl px-4 text-white text-sm font-bold disabled:opacity-50"
          style={{ backgroundColor: COLORS.orange }}
        >
          {sending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
        </button>
      </form>
    </div>
  );
}

function ChatPage({ profile, pendingBus, onConsumePendingBus }) {
  const [conversations, setConversations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedId, setSelectedId] = useState(null);
  const [starting, setStarting] = useState(false);

  const loadConversations = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const { data, error: fetchError } = await supabase
        .from("conversations")
        .select("id, type, status, bus_id, updated_at, profiles!conversations_participant_b_id_fkey(full_name)")
        .order("updated_at", { ascending: false });
      if (fetchError) throw fetchError;
      setConversations(data || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadConversations();
  }, [loadConversations]);

  const startConversationWithBus = useCallback(
    async (bus) => {
      if (!bus) return;
      setStarting(true);
      setError("");
      try {
        const { data: userData } = await supabase.auth.getUser();
        const { data: existing } = await supabase
          .from("conversations")
          .select("id")
          .eq("type", "parent_supervisor")
          .eq("bus_id", bus.id)
          .eq("participant_a_id", userData.user.id)
          .maybeSingle();

        let convId = existing?.id;
        if (!convId) {
          const { data: created, error: createError } = await supabase
            .from("conversations")
            .insert({
              type: "parent_supervisor",
              participant_a_id: userData.user.id,
              participant_b_id: bus.supervisor_id || null,
              bus_id: bus.id,
            })
            .select("id")
            .single();
          if (createError) throw createError;
          convId = created.id;
        }
        await loadConversations();
        setSelectedId(convId);
      } catch (err) {
        setError(err.message);
      } finally {
        setStarting(false);
        onConsumePendingBus?.();
      }
    },
    [loadConversations, onConsumePendingBus]
  );

  useEffect(() => {
    if (pendingBus) startConversationWithBus(pendingBus);
  }, [pendingBus, startConversationWithBus]);

  async function startSupportChat() {
    setStarting(true);
    setError("");
    try {
      const { data: userData } = await supabase.auth.getUser();
      const { data: existing } = await supabase
        .from("conversations")
        .select("id")
        .eq("type", "support")
        .eq("participant_a_id", userData.user.id)
        .eq("status", "open")
        .maybeSingle();

      let convId = existing?.id;
      if (!convId) {
        const { data: created, error: createError } = await supabase
          .from("conversations")
          .insert({ type: "support", participant_a_id: userData.user.id })
          .select("id")
          .single();
        if (createError) throw createError;
        convId = created.id;
      }
      await loadConversations();
      setSelectedId(convId);
    } catch (err) {
      setError(err.message);
    } finally {
      setStarting(false);
    }
  }

  if (selectedId) {
    return <ChatThread conversationId={selectedId} profile={profile} onBack={() => setSelectedId(null)} />;
  }

  return (
    <div className="pb-4">
      <TopBar title="الدردشة" subtitle={`${conversations.length} محادثة`} />
      <ErrorBanner message={error} />

      <div className="px-4 mb-3">
        <button
          onClick={startSupportChat}
          disabled={starting}
          className="w-full rounded-2xl py-3 text-sm font-bold text-white flex items-center justify-center gap-2 disabled:opacity-70"
          style={{ backgroundColor: COLORS.orange }}
        >
          {starting && <Loader2 size={14} className="animate-spin" />}
          + تواصل مع الدعم الفني
        </button>
      </div>

      <div className="px-4">
        {loading ? (
          <Spinner />
        ) : conversations.length === 0 ? (
          <div className="text-center py-14 text-sm text-gray-400 bg-white rounded-2xl border border-gray-100">
            مفيش محادثات لسه — تقدر تبدأ محادثة مع مشرفة الباص من صفحة الرئيسية، أو تواصل مع الدعم الفني
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {conversations.map((c) => (
              <button
                key={c.id}
                onClick={() => setSelectedId(c.id)}
                className="w-full text-right flex items-center gap-3 p-3.5 rounded-2xl bg-white border border-gray-100 hover:bg-gray-50"
              >
                <div className="rounded-lg p-2.5 shrink-0" style={{ backgroundColor: (c.type === "support" ? COLORS.orange : COLORS.sky) + "18" }}>
                  <MessageCircle size={16} color={c.type === "support" ? COLORS.orange : COLORS.sky} />
                </div>
                <div className="flex-1">
                  <div className="text-sm font-semibold text-gray-700">
                    {c.type === "support" ? "الدعم الفني" : c.profiles?.full_name || "مشرفة الباص"}
                  </div>
                  <div className="text-[11px] text-gray-400">{c.status === "open" ? "مفتوحة" : "مقفولة"}</div>
                </div>
                <ChevronLeft size={18} className="text-gray-300 shrink-0" />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ================= صفحة حسابي (البروفايل + الاشتراكات + المدارس) ================= */

function EditProfileForm({ profile, onSaved }) {
  const [form, setForm] = useState({ full_name: profile.full_name || "", phone: profile.phone || "", phone_secondary: profile.phone_secondary || "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  function update(field, value) {
    setForm((p) => ({ ...p, [field]: value }));
    setSaved(false);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      const { error: updateError } = await supabase
        .from("profiles")
        .update({ full_name: form.full_name, phone: form.phone || null, phone_secondary: form.phone_secondary || null })
        .eq("id", profile.id);
      if (updateError) throw updateError;
      setSaved(true);
      onSaved?.(form);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  const inputClass = "w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-sky-300";
  const labelClass = "block text-xs font-medium text-gray-500 mb-1.5";

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      {error && <ErrorBanner message={error} />}
      {saved && (
        <div className="flex items-center gap-2 bg-green-50 border border-green-100 text-green-600 text-xs rounded-xl p-3">
          <CheckCircle2 size={16} className="shrink-0" /> تم حفظ بياناتك
        </div>
      )}
      <div>
        <label className={labelClass}>الاسم بالكامل</label>
        <input className={inputClass} value={form.full_name} onChange={(e) => update("full_name", e.target.value)} />
      </div>
      <div>
        <label className={labelClass}>رقم التليفون الأساسي</label>
        <input dir="ltr" className={inputClass + " text-left"} value={form.phone} onChange={(e) => update("phone", e.target.value)} />
      </div>
      <div>
        <label className={labelClass}>رقم بديل للطوارئ</label>
        <input dir="ltr" className={inputClass + " text-left"} value={form.phone_secondary} onChange={(e) => update("phone_secondary", e.target.value)} />
      </div>
      <button
        type="submit"
        disabled={saving}
        className="w-full rounded-xl py-2.5 text-white font-semibold text-sm flex items-center justify-center gap-2 disabled:opacity-70"
        style={{ backgroundColor: COLORS.sky }}
      >
        {saving && <Loader2 size={16} className="animate-spin" />}
        {saving ? "جارٍ الحفظ..." : "حفظ البيانات"}
      </button>
    </form>
  );
}

function ChangePasswordForm() {
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    if (password.length < 6) {
      setError("كلمة المرور لازم تكون 6 حروف/أرقام على الأقل");
      return;
    }
    setSaving(true);
    setError("");
    setSaved(false);
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) throw updateError;
      setSaved(true);
      setPassword("");
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      {error && <ErrorBanner message={error} />}
      {saved && (
        <div className="flex items-center gap-2 bg-green-50 border border-green-100 text-green-600 text-xs rounded-xl p-3">
          <CheckCircle2 size={16} className="shrink-0" /> تم تغيير كلمة المرور
        </div>
      )}
      <input
        type="password"
        dir="ltr"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="كلمة المرور الجديدة"
        className="w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm text-left focus:outline-none focus:ring-2 focus:ring-sky-300"
      />
      <button
        type="submit"
        disabled={saving}
        className="w-full rounded-xl py-2.5 text-white font-semibold text-sm flex items-center justify-center gap-2 disabled:opacity-70"
        style={{ backgroundColor: COLORS.sky }}
      >
        {saving && <Loader2 size={16} className="animate-spin" />}
        تغيير كلمة المرور
      </button>
    </form>
  );
}

function SubscriptionsSection() {
  const [subs, setSubs] = useState([]);
  const [invoicesBySub, setInvoicesBySub] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [openId, setOpenId] = useState(null);

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError("");
      try {
        const { data, error: fetchError } = await supabase
          .from("subscriptions")
          .select("id, price, status, renewal_date, students(full_name)")
          .order("renewal_date", { ascending: true });
        if (fetchError) throw fetchError;
        setSubs(data || []);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  async function toggleOpen(sub) {
    if (openId === sub.id) {
      setOpenId(null);
      return;
    }
    setOpenId(sub.id);
    if (!invoicesBySub[sub.id]) {
      const { data } = await supabase
        .from("invoices")
        .select("id, invoice_number, amount, status, issued_at")
        .eq("subscription_id", sub.id)
        .order("issued_at", { ascending: false });
      setInvoicesBySub((prev) => ({ ...prev, [sub.id]: data || [] }));
    }
  }

  if (loading) return <Spinner />;
  if (error) return <ErrorBanner message={error} />;
  if (subs.length === 0) return <div className="text-center text-xs text-gray-400 py-6">مفيش اشتراكات مسجّلة لسه</div>;

  return (
    <div className="flex flex-col gap-2">
      {subs.map((s) => {
        const statusInfo = SUBSCRIPTION_STATUS_LABELS[s.status] || { label: s.status, color: "#9CA3AF" };
        return (
          <div key={s.id} className="rounded-xl border border-gray-100 overflow-hidden">
            <button onClick={() => toggleOpen(s)} className="w-full flex items-center gap-3 p-3 hover:bg-gray-50">
              <div className="rounded-lg p-2" style={{ backgroundColor: COLORS.sun + "25" }}>
                <Receipt size={15} color="#B7791F" />
              </div>
              <div className="flex-1 text-right">
                <div className="text-sm font-semibold text-gray-700">{s.students?.full_name}</div>
                <div className="text-xs text-gray-400">{s.price} جنيه/شهرياً · التجديد {s.renewal_date}</div>
              </div>
              <span className="text-[11px] font-bold px-2.5 py-1 rounded-full" style={{ backgroundColor: statusInfo.color + "20", color: statusInfo.color }}>
                {statusInfo.label}
              </span>
            </button>
            {openId === s.id && (
              <div className="bg-gray-50 p-3 flex flex-col gap-1.5">
                {!invoicesBySub[s.id] ? (
                  <Spinner />
                ) : invoicesBySub[s.id].length === 0 ? (
                  <div className="text-[11px] text-gray-400 text-center py-3">لسه مفيش فواتير</div>
                ) : (
                  invoicesBySub[s.id].map((inv) => (
                    <div key={inv.id} className="flex items-center justify-between text-xs bg-white rounded-lg p-2.5">
                      <div>
                        <div className="font-semibold text-gray-700">{inv.invoice_number}</div>
                        <div className="text-gray-400">{new Date(inv.issued_at).toLocaleDateString("ar-EG")}</div>
                      </div>
                      <div className="text-left">
                        <div className="font-bold text-gray-700" dir="ltr">{inv.amount} جنيه</div>
                        <div style={{ color: inv.status === "paid" ? COLORS.mint : COLORS.orange }}>{inv.status === "paid" ? "مدفوعة" : "معلّقة"}</div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function SchoolsSection() {
  const [schools, setSchools] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [submittingId, setSubmittingId] = useState(null);
  const [submittedIds, setSubmittedIds] = useState([]);

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError("");
      try {
        const { data, error: fetchError } = await supabase
          .from("schools")
          .select("id, name, address_text, phone, whatsapp_number, external_apply_url")
          .eq("is_active", true)
          .order("name", { ascending: true });
        if (fetchError) throw fetchError;
        setSchools(data || []);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  async function submitInquiry(school) {
    setSubmittingId(school.id);
    setError("");
    try {
      const { data: userData } = await supabase.auth.getUser();
      const { error: insertError } = await supabase.from("school_inquiries").insert({ parent_id: userData.user.id, school_id: school.id });
      if (insertError) throw insertError;
      setSubmittedIds((prev) => [...prev, school.id]);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmittingId(null);
    }
  }

  if (loading) return <Spinner />;

  return (
    <div className="flex flex-col gap-2">
      {error && <ErrorBanner message={error} />}
      {schools.length === 0 ? (
        <div className="text-center text-xs text-gray-400 py-6">لسه مفيش مدارس مسجّلة</div>
      ) : (
        schools.map((s) => (
          <div key={s.id} className="rounded-xl border border-gray-100 p-3">
            <div className="flex items-center gap-2">
              <div className="rounded-lg p-2" style={{ backgroundColor: COLORS.mint + "18" }}>
                <School size={15} color={COLORS.mint} />
              </div>
              <div className="flex-1">
                <div className="text-sm font-semibold text-gray-700">{s.name}</div>
                <div className="text-xs text-gray-400">{s.address_text || "بدون عنوان نصي"}</div>
              </div>
            </div>
            <div className="flex gap-2 mt-2.5">
              {s.whatsapp_number && (
                <a href={`https://wa.me/${s.whatsapp_number.replace(/[^0-9]/g, "")}`} target="_blank" rel="noreferrer" className="flex-1 text-center rounded-lg py-2 text-[11px] font-bold border border-gray-200 text-gray-600">
                  واتساب
                </a>
              )}
              {s.external_apply_url && (
                <a href={s.external_apply_url} target="_blank" rel="noreferrer" className="flex-1 text-center rounded-lg py-2 text-[11px] font-bold border border-gray-200 text-gray-600">
                  رابط التقديم
                </a>
              )}
              <button
                onClick={() => submitInquiry(s)}
                disabled={submittingId === s.id || submittedIds.includes(s.id)}
                className="flex-1 rounded-lg py-2 text-[11px] font-bold text-white disabled:opacity-60"
                style={{ backgroundColor: COLORS.orange }}
              >
                {submittedIds.includes(s.id) ? "تم الإرسال ✓" : submittingId === s.id ? "..." : "تقديم طلب"}
              </button>
            </div>
          </div>
        ))
      )}
    </div>
  );
}

function AccountPage({ profile, onProfileUpdate }) {
  const [section, setSection] = useState("profile");
  const [supportPhone, setSupportPhone] = useState("");

  useEffect(() => {
    async function loadSettings() {
      const { data } = await supabase.from("app_settings").select("support_phone").single();
      setSupportPhone(data?.support_phone || "");
    }
    loadSettings();
  }, []);

  const tabs = [
    { key: "profile", label: "بياناتي" },
    { key: "subscriptions", label: "الاشتراك" },
    { key: "schools", label: "المدارس" },
  ];

  return (
    <div className="pb-4">
      <TopBar title="حسابي" subtitle={profile.full_name} />

      <div className="px-4 flex gap-2 mb-4 overflow-auto no-scrollbar">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setSection(t.key)}
            className="rounded-full px-4 py-2 text-xs font-bold shrink-0"
            style={section === t.key ? { backgroundColor: COLORS.sky, color: "white" } : { backgroundColor: "#F3F4F6", color: "#6B7280" }}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="px-4">
        <div className="bg-white rounded-2xl border border-gray-100 p-4">
          {section === "profile" && (
            <div className="flex flex-col gap-5">
              <EditProfileForm profile={profile} onSaved={onProfileUpdate} />
              <div className="border-t border-gray-100 pt-4">
                <div className="text-xs font-bold text-gray-400 mb-3">تغيير كلمة المرور</div>
                <ChangePasswordForm />
              </div>
            </div>
          )}
          {section === "subscriptions" && <SubscriptionsSection />}
          {section === "schools" && <SchoolsSection />}
        </div>

        {supportPhone && (
          <a href={`tel:${supportPhone}`} className="mt-3 w-full flex items-center justify-center gap-2 rounded-2xl py-3 text-sm font-bold border border-gray-200 text-gray-600">
            <PhoneCall size={16} /> اتصال بالدعم الفني ({supportPhone})
          </a>
        )}

        <button
          onClick={() => supabase.auth.signOut()}
          className="mt-3 w-full flex items-center justify-center gap-2 rounded-2xl py-3 text-sm font-bold text-red-500 border border-red-100 bg-red-50"
        >
          <LogOut size={16} /> تسجيل الخروج
        </button>
      </div>
    </div>
  );
}

/* ================= الهيكل الرئيسي (Bottom Nav) ================= */

function BottomNav({ page, setPage }) {
  const items = [
    { key: "home", label: "الرئيسية", icon: Home },
    { key: "children", label: "أبنائي", icon: Users },
    { key: "chat", label: "الدردشة", icon: MessageCircle },
    { key: "account", label: "حسابي", icon: User },
  ];
  return (
    <nav className="fixed bottom-0 inset-x-0 bg-white border-t border-gray-100 flex items-stretch z-40" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
      {items.map((it) => {
        const Icon = it.icon;
        const active = page === it.key;
        return (
          <button key={it.key} onClick={() => setPage(it.key)} className="flex-1 flex flex-col items-center justify-center gap-1 py-2.5">
            <Icon size={20} color={active ? COLORS.sky : "#9CA3AF"} />
            <span className="text-[10px] font-bold" style={{ color: active ? COLORS.sky : "#9CA3AF" }}>{it.label}</span>
          </button>
        );
      })}
    </nav>
  );
}

function Dashboard({ profile }) {
  const [page, setPage] = useState("home");
  const [currentProfile, setCurrentProfile] = useState(profile);
  const [pendingChatBus, setPendingChatBus] = useState(null);

  function openChatWithBus(bus) {
    setPendingChatBus(bus);
    setPage("chat");
  }

  return (
    <div className="min-h-screen bg-gray-50" dir="rtl">
      <div style={{ paddingBottom: 70 }}>
        {page === "home" && <HomePage profile={currentProfile} onOpenChatWithBus={openChatWithBus} />}
        {page === "children" && <ChildrenPage />}
        {page === "chat" && (
          <ChatPage profile={currentProfile} pendingBus={pendingChatBus} onConsumePendingBus={() => setPendingChatBus(null)} />
        )}
        {page === "account" && (
          <AccountPage profile={currentProfile} onProfileUpdate={(form) => setCurrentProfile((p) => ({ ...p, ...form }))} />
        )}
      </div>
      <BottomNav page={page} setPage={setPage} />
    </div>
  );
}

/* ================= الجذر ================= */

export default function App() {
  const [session, setSession] = useState(undefined);
  const [profile, setProfile] = useState(null);

  useEffect(() => {
    async function loadProfileForSession(currentSession) {
      if (!currentSession) {
        setSession(null);
        setProfile(null);
        return;
      }
      const { data, error } = await supabase
        .from("profiles")
        .select("id, full_name, phone, phone_secondary, role")
        .eq("id", currentSession.user.id)
        .single();

      if (error || !data || data.role !== "parent") {
        await supabase.auth.signOut();
        setSession(null);
        setProfile(null);
        return;
      }
      setProfile(data);
      setSession(currentSession);
    }

    supabase.auth.getSession().then(({ data }) => loadProfileForSession(data.session));

    const { data: listener } = supabase.auth.onAuthStateChange((_event, currentSession) => {
      loadProfileForSession(currentSession);
    });

    return () => listener.subscription.unsubscribe();
  }, []);

  if (session === undefined) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-gray-300 text-sm">جارٍ التحقق من الجلسة...</div>
      </div>
    );
  }

  return session && profile ? <Dashboard profile={profile} /> : <AuthScreen />;
}
