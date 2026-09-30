# Teleprompter Pro Studio — versión 4

App instalable (PWA) para bandas en vivo: letra con acordes, carga por partes, idioma por tema y seguimiento por voz **sin internet** (Vosk), con Google como alternativa.

## Qué hay en esta carpeta

| Archivo / carpeta | Para qué sirve |
|---|---|
| `index.html`, `app.js`, `app.css` | La app |
| `firebase-config.js` | Datos de la nube (se completa en el paso 2) |
| `manifest.json`, `sw.js`, `icons/` | Hacen que se instale y abra sin internet |
| `vendor/vosk.js` | Motor de voz sin internet |
| `models/` | Modelos de voz en español e inglés, en partes (licencia Apache 2.0 de Alpha Cephei) |

---

## Paso 1 — Publicarla gratis en GitHub Pages

1. Crear una cuenta en github.com (gratis).
2. Crear un repositorio nuevo, **público**, por ejemplo `teleprompter`.
3. Subir **todo el contenido de esta carpeta** (no la carpeta, su contenido) con **Add file → Upload files**, arrastrando los archivos y carpetas.
   - Los modelos de voz están partidos en pedazos de menos de 20 MB (`.part0`, `.part1`…) para que la web de GitHub los acepte. La app los une sola al descargarlos. No hay que unirlos a mano.
4. En el repositorio: **Settings → Pages → Source: Deploy from a branch → Branch: main / (root) → Save**.
5. En un par de minutos la app queda en `https://TU-USUARIO.github.io/teleprompter/`.

## Paso 2 — Nube para compartir la lista (Firebase, plan gratuito)

Sin este paso la app funciona igual, pero cada lista queda guardada solo en el dispositivo donde se cargó.

1. Entrar a console.firebase.google.com → **Crear proyecto** (se puede desactivar Analytics).
2. Menú **Compilación → Firestore Database → Crear base de datos** (ubicación sugerida: `southamerica-east1`).
3. Pestaña **Reglas**, reemplazar todo por esto y tocar **Publicar**:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /listas/{lista} {
      allow read, write: if true;
      match /historial/{version} {
        allow read, write: if true;
      }
    }
  }
}
```

4. **Configuración del proyecto (engranaje) → General → Tus apps → ícono web `</>`** → registrar la app.
5. Copiar `projectId` y `apiKey` en `firebase-config.js`:

```js
window.TP_CLOUD = {
  projectId: "mi-proyecto",
  apiKey: "AIzaSy..."
};
```

6. Volver a subir `firebase-config.js` al repositorio.

> Con estas reglas, cualquiera que conozca el nombre de una lista puede verla y modificarla. Es lo acordado (acceso por nombre de lista, sin usuarios ni contraseñas). Conviene usar nombres poco obvios, por ejemplo `Rusty Hats 001`.

## Paso 3 — Instalarla en tablets y celulares

1. Abrir la dirección de GitHub Pages **con internet**.
- **Android (Chrome):** menú ⋮ → **Instalar app** o **Agregar a pantalla principal**.
- **iPhone / iPad (Safari):** botón Compartir → **Agregar a inicio**.
2. Escribir el nombre de la lista (por ejemplo `Rusty Hats 001`).
3. Tocar **⚙ Ajustes → Descargar** los modelos de voz que se vayan a usar (español y/o inglés). Se descargan una sola vez.
4. Desde ese momento abre y sigue la letra sin internet. La nube solo se usa para traer o subir cambios de la lista.

---

## Cómo se usa

**Pantalla principal:** igual que antes (Play, tono, acordes, guía, pedal, ventana de 20 segundos entre temas). Nuevo: el distintivo **ES / EN** muestra el idioma del tema.

**Editar la lista:** botón con el nombre de la lista.
- Cada tema tiene título, BPM, **idioma** y guía para la banda.
- La letra se carga **por partes**, en el orden en que se canta: Intro, Estrofa, Pre-estribillo, Estribillo, Puente, Solo, Instrumental, Interludio, Final, u **Otro** con nombre propio. Cada parte se escribe completa, aunque se repita.
- Los acordes se escriben a mano entre corchetes: `De [G]vez en cuando`.
- Lo que se pega de afuera no se modifica.
- Intro, Solo, Instrumental e Interludio se muestran como aviso para la banda y la voz no los sigue.
- Los temas cargados antes quedan como estaban. Con **Cargar por partes** se pasan al formato nuevo.

**Guardar:** nada se guarda hasta tocar **💾 Guardar cambios**. Si se sale con cambios sin guardar, la app pregunta. Si el dispositivo se apaga a mitad de una edición, al volver ofrece continuarla.

**Historial:** cada guardado deja la versión anterior en el historial (últimas 5). **Restaurar** vuelve la lista completa a esa versión.

**Seguimiento por voz:**
- Escucha solo las frases de la parte actual y la siguiente, en el idioma del tema.
- Avanza palabra por palabra y nunca retrocede. Si se pierde, se corrige a mano (pedal o tocando la palabra).
- Durante la intro y los solos espera a que se cante.
- **✓ Así se canta:** aparece al terminar un tema. Si se toca, el dispositivo recuerda qué partes no llegaron a la voz (por ejemplo, un estribillo que canta el público) y la próxima vez las tiene en cuenta. Si no se toca, no aprende nada.

**Atajos de teclado:** R rebobinar • V voz • M espejo • F pantalla completa • G guía • P o [ tema anterior • N o ] tema siguiente • + / − tono.

## Reglamento de uso (borrador para la versión comercial)

- Una sola persona edita la lista a la vez. Coordinarlo en la banda antes de editar.
- Cada edición termina con **Guardar cambios**.
- Antes de un show, abrir la lista con internet en cada dispositivo para tener la última versión.
- Exportar la lista de vez en cuando como respaldo extra (**⬇ Exportar**).

## Estado de las pruebas

Probado en navegador (Chromium) de escritorio, tablet y celular:
- Seguimiento con voz sintética en inglés con Vosk: sigue palabra por palabra, con ruido de fondo, y retoma si se cambian palabras de la letra.
- Guardado, historial de 5, restaurar, borrador recuperado, pedal, apertura sin internet.

**Pendiente de probar en real:** la nube de Firebase (no se pudo conectar desde el entorno de prueba), el modelo en español con voz real y el rendimiento en tablets y celulares. Para eso, la prueba con una pista de karaoke de fondo.
