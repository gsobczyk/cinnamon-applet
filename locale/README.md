
```
xgettext applet.js -L JavaScript -o locale/pl/LC_MESSAGES/hamster-shell-extension.pot
msgmerge -U locale/pl/LC_MESSAGES/hamster-shell-extension.po  locale/pl/LC_MESSAGES/hamster-shell-extension.pot
msgfmt -o locale/pl/LC_MESSAGES/hamster-shell-extension.mo  locale/pl/LC_MESSAGES/hamster-shell-extension.po
```