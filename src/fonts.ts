import * as browser from "webextension-polyfill";

export const addFont = async (
  font_name: string,
  relative_path: string,
  descriptors?: FontFaceDescriptors
) => {
  try {
    const absolute_path = browser.runtime.getURL(relative_path);
    const font = new FontFace(font_name, `url("${absolute_path}")`, descriptors);

    await font.load();
    document.fonts.add(font);
  } catch (e) {
    console.error("Failed to load font:", font_name, relative_path, e);
  }
};

// All fonts are sourced from Google Fonts API
addFont("Material Icons", "fonts/MaterialIcons-Regular.ttf");

addFont("Klee One", "fonts/KleeOne-SemiBold.ttf");
addFont("Noto Sans JP", "fonts/NotoSansJP-Regular.otf");
addFont("Outfit", "fonts/Outfit-Regular.ttf", { weight: "400" });
addFont("Outfit", "fonts/Outfit-Medium.ttf", { weight: "500" });
addFont("Outfit", "fonts/Outfit-SemiBold.ttf", { weight: "600" });
addFont("Outfit", "fonts/Outfit-Bold.ttf", { weight: "700" });
addFont("Outfit", "fonts/Outfit-ExtraBold.ttf", { weight: "800" });
addFont("Outfit", "fonts/Outfit-VariableFont_wght.ttf", { weight: "100 900" });
addFont("IBM Plex Mono", "fonts/IBMPlexMono-Regular.ttf", { weight: "400" });
addFont("IBM Plex Mono", "fonts/IBMPlexMono-SemiBold.ttf", { weight: "600" });
