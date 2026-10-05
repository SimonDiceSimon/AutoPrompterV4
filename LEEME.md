# AutoPrompter — por Simón Dice

Teleprompter automático para bandas en vivo: letra con acordes, carga por partes y seguimiento por voz **sin internet**. Se instala como app en celulares, tablets y computadoras.

Versión actual: ver **CAMBIOS.md**.

## Qué hay en esta carpeta

| Archivo / carpeta | Para qué sirve |
|---|---|
| `index.html`, `app.js`, `app.css` | La app |
| `firebase-config.js` | Datos de conexión a la nube (Firebase) |
| `manifest.json`, `sw.js`, `icons/` | Instalación, funcionamiento sin internet, íconos y logos |
| `vendor/vosk.js` | Motor de voz (funciona dentro del dispositivo) |
| `models/` | Modelos de voz en español e inglés, partidos en pedazos (licencia Apache 2.0 de Alpha Cephei) |
| `CAMBIOS.md` | Registro de versiones |

## Instalar en cada dispositivo

1. Abrir el link de la app **con internet**.
2. **iPhone / iPad:** Compartir → **Agregar a inicio**. **Mac (Safari):** Archivo → **Agregar al Dock**. **Android / Windows (Chrome):** menú → **Instalar app**.
3. Usarla siempre desde ese ícono. En los equipos Apple, el ícono y Safari guardan sus datos por separado: si se usan los dos, cuentan como dos dispositivos.
4. La primera vez, la app descarga sola la voz en español e inglés (unos 75 MB, una sola vez).

## Bandas y listas

- Al abrir la app, siempre aparece el **código de la banda**. Se escribe exacto, como una contraseña.
- Si el código no existe, la app pregunta si se quiere **crear la banda** y cuántos dispositivos la van a usar.
- Al crear la banda aparece un **código de rescate**: guardarlo (foto o nota). Sirve para entrar aunque se llene el límite o se pierdan todos los dispositivos.
- Adentro de la banda están **todas sus listas**. ⭐ marca la lista oficial (aparece primera).
- **Dispositivos:** cada banda tiene un límite. Desde adentro se puede quitar un dispositivo que ya no se usa o sumar un lugar.
- **Traer lista de la versión anterior:** copia adentro de la banda las listas de la v4.0/4.1.
- **↩ Seguir en:** vuelve con un toque a la última lista usada (útil si la app se recarga en el show).
- Para un solista: crear una "banda" propia con un código que nadie adivine.

## Pantalla principal

- Botón **🎸 Banda › Lista**: cambiar de lista o de banda. Botón **✏️ Editar**: editar la lista.
- **Indicador de voz**: 🟡 preparando · 🟢 en espera · 🔵 reconoció una palabra · 🔴 sin micrófono. La barrita al lado muestra si el micrófono escucha.
- **Letra** y **Acorde**: tamaños por separado. **Cifrado: C / Do**: americano o latino.
- **Franja** y **Velocidad (voz OFF)**: abajo. La velocidad solo se usa con la voz apagada.

## Editar la lista

- Cada tema: **nombre, BPM, idioma** y **guía para la banda**.
- La letra se carga **por partes**, en el orden en que se canta (Intro, Estrofa, Pre-estribillo, Estribillo, Puente, Solo, Instrumental, Interludio, Final u Otro).
- Acordes con el **selector** (tocar en la letra antes de la sílaba, elegir y tocar Insertar) o escritos entre corchetes o paréntesis: `[G]`, `(Sol)`, `[Lam)`.
- Debajo de cada parte hay una **vista previa**.
- Nada se guarda hasta tocar **💾 Guardar cambios**. Cada guardado deja la versión anterior en el **historial** (últimas 5).

## Seguimiento por voz

- Motor único: **Vosk**, dentro del dispositivo y sin internet.
- Escucha solo las frases de la parte actual y la siguiente, en el idioma del tema.
- Avanza palabra por palabra, nunca retrocede, y no da saltos imposibles (según el tiempo y el BPM).
- **✓ Así se canta:** al terminar un tema, guarda qué partes no llegaron a la voz (solo si se toca).

## Para quien la mantiene

- Cómo publicar una versión nueva y cómo volver a una anterior: ver la carpeta **AutoPrompter V4 Respaldos** (COMO-RESTAURAR.txt).
- Reglas de Firebase y pasos de la v4.2: `PASOS-PARA-PUBLICAR-v4.2.txt` y `reglas-firebase-v4.2.txt` en Respaldos.
