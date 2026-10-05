# AutoPrompter V4 — Registro de cambios

Cada versión nueva se agrega arriba de todo.

---

## v4.2 — 01/10/2026
**Qué cambió**
- Nuevo nombre: **AutoPrompter**, con los logos de Simón Dice (ícono SD, logo en la pantalla de inicio y en Ajustes) y número de versión visible.
- **Código de banda**: al abrir, se escribe el código; adentro aparecen todas las listas de la banda, con ⭐ lista oficial y **+ Nueva lista**.
- Bandas abiertas en el dispositivo (con ✕ para quitarlas) y botón **↩ Seguir en** para volver a la última lista.
- **Candado de dispositivos**: cada dispositivo tiene una identificación anónima; la banda tiene un límite que se maneja desde adentro (quitar dispositivos, sumar lugares). La propia nube rechaza a los dispositivos no habilitados.
- **Código de rescate** al crear una banda.
- **Traer lista de la versión anterior** (Simon01, Simon 02…).
- **Voz solo con Vosk** (se sacó Google). Descarga los dos idiomas al abrir la app por primera vez y prepara la voz antes de tocar Iniciar; tiene un idioma por vez en memoria y precarga el del próximo tema.
- **Indicador de voz** (preparando, en espera, reconoció, sin micrófono) y **barrita de nivel del micrófono**.
- Ajustes: estado de la voz (**Descargado ✓**) y nombre del dispositivo.
- Editor con títulos fijos (Nombre del tema, BPM, Idioma, Guía para la banda). Deslizadores **Franja** y **Velocidad (voz OFF)**.
- La primera línea de cada tema arranca centrada en la franja, y se vuelve a centrar al abrir o cerrar la guía.

**Requiere en Firebase** (una sola vez): activar el acceso anónimo y pegar las reglas nuevas. Ver PASOS-PARA-PUBLICAR-v4.2.txt.

**Archivos modificados:** app.js, index.html, app.css, sw.js, manifest.json, LEEME.md, CAMBIOS.md, icons/ (íconos nuevos y logos)

---

## v4.1 — 30/09/2026
**Qué cambió**
- Cifrado americano (C, D, E) o latino (Do, Re, Mi), con el botón **Cifrado: C / Do** en la pantalla principal. Cada dispositivo recuerda su elección.
- Los acordes se aceptan entre corchetes o paréntesis, aunque estén mezclados: `[G]`, `(G)`, `[Sol)`, `(Lam]`.
- Selector de acordes en el editor (nota, ♯/♭, tipo, o escrito a mano) y vista previa debajo de cada parte.
- Deslizadores separados para el tamaño de la **Letra** y de los **Acordes**.
- La franja de lectura sigue siempre el renglón que se está cantando.
- La voz no da saltos imposibles: solo avanza lo que se pudo cantar según el tiempo y el BPM.
- Los botones de arriba se acomodan en celulares.

**Archivos modificados:** app.js, index.html, app.css, sw.js, LEEME.md

---

## v4.0.1 — 30/09/2026
**Qué cambió**
- Conexión a la nube (Firebase) configurada.
- Las listas creadas antes de conectar la nube se suben solas.
- Guardar ya no espera a internet: guarda al instante y sube en segundo plano.

**Archivos modificados:** firebase-config.js, app.js, sw.js

---

## v4.0 — 30/09/2026
Primera versión publicada en GitHub Pages: app instalable, lista por nombre, borrador e historial de 5 versiones, carga por partes, idioma por tema, voz sin internet con Vosk.
