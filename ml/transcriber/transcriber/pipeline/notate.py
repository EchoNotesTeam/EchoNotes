"""Stage 3 — Quantized MIDI → MusicXML via music21.

music21 reads the quantized MIDI file, analyses the key signature, applies
instrument and tempo markings, runs makeNotation() to produce proper measures
with beaming and ties, and exports MusicXML.

The resulting MusicXML is then passed to the Verovio render stage.
"""

from __future__ import annotations

import os
import tempfile
import time

import pretty_midi
import structlog

logger = structlog.get_logger()


def run(
    midi_data: pretty_midi.PrettyMIDI,
    instrument_hint: str,
    tempo_bpm: float,
    time_sig: str,
) -> tuple[str, str, float]:
    """Convert quantized MIDI to MusicXML.

    Args:
        midi_data:       Quantized PrettyMIDI from the previous stage.
        instrument_hint: 'guitar' or 'piano'.
        tempo_bpm:       Estimated tempo from librosa.
        time_sig:        Detected time signature string, e.g. '4/4'.

    Returns:
        Tuple of (music_xml_str, key_signature_str, elapsed_seconds).
    """
    # Import inside the function to keep startup fast if the service is used
    # in contexts where music21 is unavailable.
    from music21 import (
        converter,
        environment,
        instrument as m21instrument,
        tempo as m21tempo,
    )

    t_start = time.perf_counter()

    # Suppress music21 warnings about missing MuseScore/LilyPond.
    # We use Verovio for rendering — these external programs are not needed.
    us = environment.UserSettings()
    us["warnings"] = 0
    us["autoDownload"] = "no"

    # ----------------------------------------------------------------
    # Write the quantized MIDI to a temp file so music21 can parse it.
    # music21's converter.parse() requires a file on disk for MIDI.
    # ----------------------------------------------------------------
    midi_tmp = tempfile.NamedTemporaryFile(suffix=".mid", delete=False)
    xml_tmp = tempfile.NamedTemporaryFile(suffix=".musicxml", delete=False)
    midi_tmp.close()
    xml_tmp.close()

    try:
        midi_data.write(midi_tmp.name)
        score = converter.parse(midi_tmp.name)

        # ----------------------------------------------------------------
        # Key signature analysis (Krumhansl–Schmuckler algorithm).
        # ----------------------------------------------------------------
        try:
            key_obj = score.analyze("key")
            # e.g. 'C major', 'A minor', 'F# major'
            key_str = f"{key_obj.tonic.name} {key_obj.mode}"
        except Exception:
            key_str = "C major"

        # ----------------------------------------------------------------
        # Apply instrument label, tempo marking, and key/time signatures
        # to every part (there is typically only one part from a MIDI).
        # ----------------------------------------------------------------
        num_beats, beat_unit = (int(x) for x in time_sig.split("/"))

        for part in score.parts:
            # Tempo metronome marking at measure 1.
            part.insert(0.0, m21tempo.MetronomeMark(number=round(tempo_bpm)))

            # Instrument label (affects display name in the score header).
            if instrument_hint == "guitar":
                part.insert(0.0, m21instrument.Guitar())
            else:
                part.insert(0.0, m21instrument.Piano())

        # ----------------------------------------------------------------
        # makeNotation: creates proper measures, beam groups, and ties.
        # This is the step that makes the score legible — without it,
        # music21 may output a flat note list with no bar lines.
        # ----------------------------------------------------------------
        score.makeNotation(inPlace=True)

        # ----------------------------------------------------------------
        # Export to MusicXML (UTF-8).
        # ----------------------------------------------------------------
        score.write("musicxml", fp=xml_tmp.name)
        with open(xml_tmp.name, "r", encoding="utf-8") as f:
            music_xml = f.read()

    except Exception:
        raise
    finally:
        for path in (midi_tmp.name, xml_tmp.name):
            try:
                os.unlink(path)
            except OSError:
                pass

    elapsed = time.perf_counter() - t_start

    # Validate that we got non-trivial MusicXML output.
    if len(music_xml) < 200:
        raise ValueError(
            "music21 produced an empty or invalid MusicXML document. "
            "This can happen when the quantized MIDI has no notes in a "
            "recognizable time grid."
        )

    logger.debug("notate_complete", key=key_str, xml_bytes=len(music_xml))
    return music_xml, key_str, elapsed
