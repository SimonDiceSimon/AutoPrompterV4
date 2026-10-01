# AutoPrompter V4 — Registro de cambios

Cada versión nueva se agrega arriba de todo.

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
