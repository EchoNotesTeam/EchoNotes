---
title: "Cómo EchoNotes convierte audio en partitura usando IA"
date: "2026-05-31"
excerpt: "Un recorrido técnico por el pipeline de cuatro etapas que transforma una grabación de guitarra o piano en una partitura MusicXML lista para usar."
author: "Equipo EchoNotes"
---

## El problema que queríamos resolver

Cualquier músico sabe la frustración: tienes una idea musical, la grabas en tu teléfono y luego no hay forma sencilla de convertirla en partitura. Transcribir manualmente puede tomar horas; contratar un arreglista, semanas. EchoNotes automatiza ese proceso usando inteligencia artificial.

## El pipeline de cuatro etapas

La magia ocurre dentro del **ML Service** — un microservicio Python que encadena cuatro bibliotecas especializadas:

### Etapa 1 — Basic Pitch (detección de notas)

[Basic Pitch](https://basicpitch.spotify.com/) es un modelo de transcripción polifónica desarrollado por Spotify Research y publicado en ICASSP 2022. Recibe el audio crudo y devuelve una lista de notas con:

- **Onset** (cuándo empieza la nota, en segundos)
- **Offset** (cuándo termina)
- **Pitch** (altura, como número MIDI)
- **Amplitud** (velocidad de la nota)
- **Confianza** por frame

El modelo corre completamente en CPU — no requiere GPU para la demo. En un archivo de 3 minutos, procesa en aproximadamente 6 minutos.

### Etapa 2 — librosa (cuantización rítmica)

El problema de Basic Pitch es que devuelve tiempos continuos en segundos. Una nota que debería ser una negra podría aparecer como `0.4983 segundos` de duración. Sin cuantización, `music21` produciría notación completamente ilegible.

Usamos `librosa.beat.beat_track()` para:

1. Estimar el **tempo** en BPM
2. Construir un **grid de tiempos** basado en los beats
3. **Alinear** cada onset/offset al subdividente más cercano (16avos por defecto)

También detectamos el compás comparando la varianza de grupos de 3 vs 4 tiempos — si la varianza de grupos de 3 es significativamente menor, usamos 3/4; en caso contrario, 4/4.

### Etapa 3 — music21 (notación musical)

Con el MIDI cuantizado, `music21` hace tres cosas importantes:

- **Detecta la tonalidad** usando el algoritmo de Krumhansl-Schmuckler
- **Organiza en compases** con la firma de tiempo detectada
- **Aplica `makeNotation()`** que une notas adyacentes del mismo pitch con ligaduras y divide notas largas en los barlines

El resultado es un archivo **MusicXML** — el estándar internacional de partituras digitales, compatible con MuseScore, Sibelius y Finale.

### Etapa 4 — Verovio (renderizado visual)

[Verovio](https://www.verovio.org/) es el motor de renderizado oficial de MEI (Music Encoding Initiative). Toma el MusicXML y produce:

- **SVG**: un vector de alta resolución que el navegador puede mostrar directamente (usado para el visor inline)
- **PDF**: para imprimir o archivar

Usamos `adjustPageHeight=1` para que el SVG sea una sola página continua que el usuario puede desplazar, sin paginación.

## La arquitectura de servicios

El pipeline ML no corre directamente en el backend principal — está aislado en su propio contenedor Docker por una buena razón: TensorFlow carga aproximadamente 800 MB de RAM. Separarlo permite que el backend TypeScript (Fastify) y el orquestador Go respondan instantáneamente mientras el pipeline procesa en background.

```
Browser → Fastify (TypeScript) → Go Orchestrator → Redis Queue
                                        ↓
                                  Python ML Service
                                  (Basic Pitch + librosa + music21 + Verovio)
```

El usuario sube su audio, el backend responde en < 200ms con un `job_id`, y el progreso llega en tiempo real vía WebSocket.

## Resultados y limitaciones

El sistema funciona mejor con:

- **Piano solista** con tempo estable (F1 ≈ 0.65–0.75 en GiantMIDI-Piano)
- **Guitarra clásica** en posición, sin bends ni hammer-ons agresivos

Las limitaciones actuales:

- No soporta grabaciones con múltiples instrumentos (no hay separación de fuentes)
- El rubato severo confunde al estimador de tempo de librosa
- La transcripción de acordes complejos puede producir notas fantasma

Estas son limitaciones conocidas y aceptadas para el MVP. La fase 2 planea integrar Demucs para separación de fuentes.

## ¿Quieres probarlo?

[Crea una cuenta gratis](/signup) y sube tu primera grabación. El sistema acepta WAV, MP3, FLAC, OGG y M4A hasta 25 MB.
