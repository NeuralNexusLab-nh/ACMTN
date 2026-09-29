(() => {
  "use strict";
  const supported = ["en", "zh-TW", "zh-CN", "ja", "ko", "es", "pt", "hi", "id"];
  const labels = { en: "English", "zh-TW": "繁體中文", "zh-CN": "简体中文", ja: "日本語", ko: "한국어", es: "Español", pt: "Português", hi: "हिन्दी", id: "Bahasa Indonesia" };
  let messages = {};
  let currentLocale = "en";

  function chooseLocale() {
    for (const raw of navigator.languages || [navigator.language]) {
      const locale = raw.replace("_", "-");
      if (supported.includes(locale)) return locale;
      if (locale.toLowerCase().startsWith("zh")) return locale.toLowerCase().includes("tw") || locale.toLowerCase().includes("hk") ? "zh-TW" : "zh-CN";
      const language = locale.split("-")[0];
      if (supported.includes(language)) return language;
    }
    return "en";
  }

  async function loadLocale(locale) {
    const response = await fetch(`/scripts/locales/${locale}.json`, { cache: "no-store" });
    if (!response.ok) throw new Error("locale unavailable");
    return response.json();
  }

  function apply() {
    document.documentElement.lang = currentLocale;
    document.querySelectorAll("[data-i18n]").forEach((element) => { const value = messages[element.dataset.i18n]; if (value) element.textContent = value; });
    document.querySelectorAll("[data-i18n-placeholder]").forEach((element) => { const value = messages[element.dataset.i18nPlaceholder]; if (value) element.placeholder = value; });
    document.querySelectorAll("[data-i18n-aria]").forEach((element) => { const value = messages[element.dataset.i18nAria]; if (value) element.setAttribute("aria-label", value); });
    document.title = messages.documentTitle || document.title;
  }

  async function setLocale(locale) {
    currentLocale = supported.includes(locale) ? locale : "en";
    try { messages = await loadLocale(currentLocale); } catch { messages = await loadLocale("en"); currentLocale = "en"; }
    apply();
    document.querySelectorAll("[data-locale]").forEach((select) => select.value = currentLocale);
  }

  function t(key, fallback = key) { return messages[key] || fallback; }
  function setTheme(theme) { document.documentElement.dataset.theme = theme; }

  document.addEventListener("DOMContentLoaded", async () => {
    document.querySelectorAll("[data-locale]").forEach((select) => {
      select.replaceChildren(...supported.map((locale) => new Option(labels[locale], locale)));
      select.addEventListener("change", () => setLocale(select.value));
    });
    const preferredTheme = matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
    setTheme(preferredTheme);
    document.querySelectorAll("[data-theme-toggle]").forEach((button) => button.addEventListener("click", () => setTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark")));
    await setLocale(chooseLocale());
    document.dispatchEvent(new CustomEvent("acmtn:i18n-ready"));
  });

  window.ACMTNI18n = { setLocale, t };
})();
