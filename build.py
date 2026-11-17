#!/usr/bin/env python3
"""Builds all three Whatdo targets from src/.
   web/index.html            -> single self-contained file (upload to InfinityFree htdocs)
   extension/                -> load unpacked in Chrome/Edge
   android-app/www/              -> web assets for the Capacitor project
"""
import pathlib, re, shutil

root = pathlib.Path(__file__).parent
src = root / "src"
rd = lambda n: (src / n).read_text(encoding="utf-8")
tpl = rd("app.html")
css, core, cfg = rd("app.css"), rd("app.js"), rd("config.js")

def inline(platform_js):
    head = f"<style>\n{css}\n</style>"
    body = f"<script>\n{cfg}\n</script>\n<script>\n{rd(platform_js)}\n</script>\n<script>\n{core}\n</script>"
    return tpl.replace("<!--INLINE_HEAD-->", head).replace("<!--INLINE_BODY-->", body)

# Web: one file
(root / "web").mkdir(exist_ok=True)
(root / "web" / "index.html").write_text(inline("platform-web.js"), encoding="utf-8")

# Android: one file inside www/
(root / "android-app" / "www").mkdir(parents=True, exist_ok=True)
(root / "android-app" / "www" / "index.html").write_text(inline("platform-android.js"), encoding="utf-8")

# Extension: MV3 forbids inline scripts -> separate files
ext = root / "extension"
ext.mkdir(exist_ok=True)
html = (tpl.replace("<!--INLINE_HEAD-->", '<link rel="stylesheet" href="app.css">')
           .replace("<!--INLINE_BODY-->", '<script src="config.js"></script>\n<script src="platform.js"></script>\n<script src="app.js"></script>'))
(ext / "popup.html").write_text(html, encoding="utf-8")
(ext / "app.css").write_text(css, encoding="utf-8")
(ext / "app.js").write_text(core, encoding="utf-8")
(ext / "config.js").write_text(cfg, encoding="utf-8")
(ext / "platform.js").write_text(rd("platform-ext.js"), encoding="utf-8")
print("built web/, extension/, android-app/www/")
