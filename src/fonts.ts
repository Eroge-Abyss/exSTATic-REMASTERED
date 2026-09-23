import * as browser from "webextension-polyfill";

export const addFont = async (
  font_name: string,
  relative_path: string,
  descriptors?: FontFaceDescriptors
) => {
  const absolute_path = browser.runtime.getURL(relative_path);
  const font = new FontFace(font_name, `url("${absolute_path}")`, descriptors);

  await font.load();
  document.fonts.add(font);
};

// All fonts are sourced from Google Fonts API
addFont("Material Icons", "fonts/MaterialIcons-Regular.ttf");

addFont("Klee One", "fonts/KleeOne-SemiBold.ttf");
addFont("Noto Sans JP", "fonts/NotoSansJP-Regular.otf");
addFont("Outfit", "fonts/Outfit-VariableFont_wght.ttf", { weight: "100 900" });
addFont("IBM Plex Mono", "fonts/IBMPlexMono-Regular.ttf", { weight: "400" });
addFont("IBM Plex Mono", "fonts/IBMPlexMono-SemiBold.ttf", { weight: "600" });
