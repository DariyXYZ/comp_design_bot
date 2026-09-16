"""Собирает docs/*.html из src/*.body.html + shared.css (самодостаточные файлы)."""
import io, sys
css = io.open("shared.css", encoding="utf-8").read()
fonts = '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Unbounded:wght@500;600&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap">'
PAGES = {"bot-deploy": "Развёртывание comp_design_bot", "service-map": "Карта сервиса comp_design_bot"}
out = sys.argv[1] if len(sys.argv) > 1 else None
for name, title in PAGES.items():
    body = io.open(f"src/{name}.body.html", encoding="utf-8").read()
    io.open(f"{name}.html", "w", encoding="utf-8", newline="\n").write(
        f'<!doctype html>\n<html lang="ru">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>{title}</title>\n{fonts}\n<style>\n{css}\n</style>\n</head>\n<body>\n{body}\n</body>\n</html>\n')
    if out:
        io.open(f"{out}/{name}.html", "w", encoding="utf-8", newline="\n").write(f"<title>{title}</title>\n{fonts}\n<style>\n{css}\n</style>\n{body}")
print("built")
