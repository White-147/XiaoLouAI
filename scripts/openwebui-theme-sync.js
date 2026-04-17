(function () {
  var CHANNEL = "xiaolou.theme";
  var DARK_THEME_COLOR = "#171717";
  var LIGHT_THEME_COLOR = "#ffffff";
  var OLED_THEME_VARS = [
    "--color-gray-800",
    "--color-gray-850",
    "--color-gray-900",
    "--color-gray-950",
  ];

  function normalizeTheme(value) {
    return value === "light" ? "light" : "dark";
  }

  function applyTheme(theme) {
    var resolvedTheme = normalizeTheme(theme);
    var root = document.documentElement;
    var metaThemeColorTag = document.querySelector('meta[name="theme-color"]');

    try {
      localStorage.theme = resolvedTheme;
    } catch (error) {
      console.warn("[XiaoLou] Failed to persist Open WebUI theme.", error);
    }

    root.classList.remove("light", "dark", "her");
    OLED_THEME_VARS.forEach(function (key) {
      root.style.removeProperty(key);
    });
    root.classList.add(resolvedTheme);

    if (metaThemeColorTag) {
      metaThemeColorTag.setAttribute(
        "content",
        resolvedTheme === "light" ? LIGHT_THEME_COLOR : DARK_THEME_COLOR,
      );
    }
  }

  window.addEventListener("message", function (event) {
    var data = event.data;
    if (!data || data.channel !== CHANNEL || data.direction !== "set") {
      return;
    }

    applyTheme(data.theme);
  });

  window.__XIAOLOU_APPLY_OPEN_WEBUI_THEME__ = applyTheme;
})();
