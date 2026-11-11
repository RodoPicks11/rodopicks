# RodoPicks · Fantasy NFL

Tablero web de RodoPicks y endpoint público de contenido para Instagram.

## Estructura

```
public/                         → el sitio (lo que se publica)
  index.html                    → tablero
  content-core.mjs              → cálculos del contenido público (los usan el endpoint y el botón de exportar)
  openapi.yaml                  → esquema para conectar el endpoint a un GPT de ChatGPT
  manifest.webmanifest, íconos
netlify/functions/
  content-latest.mjs            → GET /api/content/latest
netlify.toml                    → configuración de Netlify (sin comando de build)
ejemplo-respuesta.json          → ejemplo de respuesta con datos ficticios
```

## Endpoint

`GET https://rodopicks.netlify.app/api/content/latest`

| Parámetro | Opcional | Qué hace |
|---|---|---|
| `week` | sí | Semana NFL de 1 a 18. Sin él, usa la semana actual según Sleeper. |
| `top` | sí | Jugadores por posición en los rankings (1 a 50). Para ChatGPT usar 12. |

- Solo lectura, sin claves y sin datos de ligas, usuarios ni identificadores de Sleeper.
- Puntuación PPR. Los niveles (titular, flex, banca) suponen una liga de 12 equipos.
- Caché en Netlify de 30 minutos: las fuentes se consultan como máximo dos veces por hora.
- `validacion.estado` = `ok` o `parcial`; `validacion.camposFaltantes` lista lo que no llegó. Un dato en `null` no existe y no se rellena.

## Exportar desde el sitio

Abrir `https://rodopicks.netlify.app/?admin=1` una vez en el navegador del administrador.
Aparece el botón **Exportar contenido para Instagram**, que descarga el mismo JSON.
`?admin=0` lo oculta. El botón solo oculta la opción: el contenido es público de todas formas.

## Publicar

Este proyecto necesita despliegue desde GitHub (las funciones no corren con arrastrar y soltar).
Cada cambio que se sube al repositorio se publica solo.
