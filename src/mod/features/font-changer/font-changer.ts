import availableFonts from "@ui/assets/fonts/fonts.json";

const stylesheetName = "yandex-music-mod-font-changer-style";

async function updateFont() {
  const savedFontValue = await window.yandexMusicMod.getStorageValue("font-changer/savedFont");
  const fontChangerEnabled = await window.yandexMusicMod.getStorageValue("font-changer/enabled");
  
  let fontFamily = savedFontValue;
  let extraStylesheet = "";
  
  const predefinedFont = availableFonts.find((font) => font.name === savedFontValue);
  if (predefinedFont) {
    fontFamily = predefinedFont.family;
    extraStylesheet = predefinedFont.extraStylesheet || "";
  } else if (!fontFamily) {
    fontFamily = availableFonts[0]?.family || "Arial";
  }

  console.log("[font-changer]", {
    savedFontValue,
    fontFamily,
    fontChangerEnabled,
  });

  document.getElementById(stylesheetName)?.remove();

  if (!fontChangerEnabled) return;

  if (!fontFamily) {
    console.error("[font-changer]", "No font found");
    return;
  }

  const styleSheet = document.createElement("style");
  styleSheet.id = stylesheetName;
  styleSheet.innerHTML = `* {
  font-family: "${fontFamily}" !important;
}
${extraStylesheet}
`;
  document.head.appendChild(styleSheet);
}

window.yandexMusicMod.onStorageChanged((key: string, value: any) => {
  if (key.includes("font-changer")) updateFont();
});

updateFont();
